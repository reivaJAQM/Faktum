import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CapturedKeyEntry,
  DownloadFormats,
  DownloadProgressEvent,
  ParsedComprobante,
} from '../../shared/types';
import { decodeClaveAcceso } from './claveAcceso';
import { exportComprobantesToExcel } from './excelExporter';
import {
  buildComprobantePaths,
  getMonthFolderName,
  getOwnerFolderName,
} from './pathLayout';
import { generateRidePdf } from './rideGenerator';
import { fetchAuthorizedXmlFromSri } from './sriSoap';
import type { FaktumStore } from './store';
import { parseSriComprobanteXml } from './xmlParser';

export type OriginalDocFetcher = (params: {
  claveAcceso: string;
  rowIndex?: number;
  numeroComprobante?: string;
  rucEmisor?: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; buffer?: Buffer; reason?: string }>;

export class DownloadManager {
  private activeAbortController: AbortController | null = null;
  private isRunning = false;
  private originalPdfFetcher: OriginalDocFetcher | null = null;
  private originalXmlFetcher: OriginalDocFetcher | null = null;

  constructor(
    private readonly store: FaktumStore,
    private readonly onProgress: (event: DownloadProgressEvent) => void
  ) {}

  public setOriginalPdfFetcher(fetcher: OriginalDocFetcher | null): void {
    this.originalPdfFetcher = fetcher;
  }

  public setOriginalXmlFetcher(fetcher: OriginalDocFetcher | null): void {
    this.originalXmlFetcher = fetcher;
  }

  public isBusy(): boolean {
    return this.isRunning;
  }

  public cancel(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
  }

  public async runBatch(params: {
    profileId: string;
    entries: CapturedKeyEntry[];
    periodYear?: number;
    periodMonth?: number;
    formats?: DownloadFormats;
    exportExcel?: boolean;
  }): Promise<DownloadProgressEvent & { collected: ParsedComprobante[] }> {
    if (this.isRunning) {
      throw new Error('Ya hay una descarga masiva en progreso.');
    }

    const profileData = this.store.getProfileWithPassword(params.profileId);
    if (!profileData) {
      throw new Error('No se encontró el perfil de RUC seleccionado.');
    }

    const { profile } = profileData;
    const settings = this.store.getSettings();
    const formats: DownloadFormats = {
      xml: params.formats?.xml ?? settings.defaultDownloadXml ?? true,
      pdf: params.formats?.pdf ?? settings.defaultDownloadPdf ?? true,
      excel: params.formats?.excel ?? params.exportExcel ?? settings.autoExportExcel ?? true,
    };

    const jobId = crypto.randomUUID();
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    this.isRunning = true;

    const uniqueMap = new Map<string, CapturedKeyEntry>();
    for (const e of params.entries) {
      const clean = e.claveAcceso.replace(/\D/g, '');
      if (clean.length === 49 && !uniqueMap.has(clean)) {
        uniqueMap.set(clean, { ...e, claveAcceso: clean });
      }
    }
    // Keep original SRI table order (rowIndex ascending) so multi-page PDF fetches never thrash pages
    const queue = Array.from(uniqueMap.values()).sort(
      (a, b) => (a.rowIndex ?? Number.MAX_SAFE_INTEGER) - (b.rowIndex ?? Number.MAX_SAFE_INTEGER)
    );

    const rucFolderName = getOwnerFolderName(profile.alias, profile.ruc);
    const firstDecoded = queue[0] ? decodeClaveAcceso(queue[0].claveAcceso) : null;
    const periodYear = String(params.periodYear ?? firstDecoded?.year ?? new Date().getFullYear());
    const monthNum =
      params.periodMonth ?? (firstDecoded ? Number(firstDecoded.month) : new Date().getMonth() + 1);
    const monthFolderName = getMonthFolderName(monthNum);
    const periodRootFolder = path.join(settings.outputDir, rucFolderName, periodYear, monthFolderName);
    const excelFolder = path.join(periodRootFolder, 'Excel');

    // Only create directories lazily when a file is actually written (never leave empty folders!)
    const ensuredDirs = new Set<string>();
    const ensureDir = (dir: string) => {
      if (!ensuredDirs.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        ensuredDirs.add(dir);
      }
    };

    const state: DownloadProgressEvent = {
      jobId,
      status: 'running',
      total: queue.length,
      processed: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      outputFolder: periodRootFolder,
      errors: [],
    };

    const collectedForExcel: ParsedComprobante[] = [];
    const dirtyRecords: ParsedComprobante[] = [];

    let lastEmitAt = 0;
    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmitAt < 80) return;
      lastEmitAt = now;
      this.onProgress({
        ...state,
        errors: [...state.errors],
      });
    };

    emit(true);

    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        if (abortController.signal.aborted) break;
        const idx = cursor++;
        const entry = queue[idx];
        const clave = entry.claveAcceso;
        const decoded = decodeClaveAcceso(clave);

        state.currentKey = clave;
        state.currentEmitter = entry.razonSocialEmisor || entry.rucEmisor || decoded?.rucEmisor || '';
        emit();

        const yearSeg = decoded?.year ?? periodYear;
        const docMonthNum = decoded ? Number(decoded.month) : monthNum;

        const existing = this.store.getComprobanteByKey(clave);
        const hasXmlOnDisk = Boolean(existing?.xmlPath && fs.existsSync(existing.xmlPath));
        const hasOriginalSriPdfOnDisk = Boolean(
          existing?.pdfPath && existing.pdfSource === 'sri' && fs.existsSync(existing.pdfPath)
        );

        // Fast path: reuse existing parsed metadata & original files already on disk
        if (existing && (!formats.xml || hasXmlOnDisk)) {
          let updated = existing;
          let didDownloadNew = false;

          if (formats.pdf && !hasOriginalSriPdfOnDisk) {
            const paths = buildComprobantePaths({
              outputDir: settings.outputDir,
              ownerRuc: profile.ruc,
              ownerAlias: profile.alias,
              year: yearSeg,
              month: docMonthNum,
              rucEmisor: existing.rucEmisor || decoded?.rucEmisor || '',
              razonSocialEmisor: existing.razonSocialEmisor || entry.razonSocialEmisor || '',
              tipoCodigo: existing.tipoCodigo,
              fechaEmisionIso: existing.fechaEmisionIso,
              numeroComprobante: existing.numeroComprobante,
              claveAcceso: clave,
            });

            let pdfRes: { ok: boolean; buffer?: Buffer; reason?: string } = {
              ok: false,
              reason: 'El portal del SRI no está abierto en Comprobantes Recibidos.',
            };
            if (this.originalPdfFetcher) {
              pdfRes = await this.originalPdfFetcher({
                claveAcceso: clave,
                rowIndex: entry.rowIndex,
                numeroComprobante: existing.numeroComprobante || decoded?.numeroComprobante,
                rucEmisor: existing.rucEmisor || decoded?.rucEmisor || entry.rucEmisor,
                signal: abortController.signal,
              });
            }

            if (pdfRes.ok && pdfRes.buffer) {
              ensureDir(paths.pdfDir);
              await fs.promises.writeFile(paths.pdfPath, pdfRes.buffer);
              updated = { ...existing, pdfPath: paths.pdfPath, pdfSource: 'sri' };
              dirtyRecords.push(updated);
              didDownloadNew = true;
            } else if (!abortController.signal.aborted) {
              // Fallback: generate local RIDE PDF from already-parsed official XML so no document is left without PDF
              const hasLocalPdfOnDisk = Boolean(existing.pdfPath && fs.existsSync(existing.pdfPath));
              if (!hasLocalPdfOnDisk) {
                try {
                  ensureDir(paths.pdfDir);
                  await generateRidePdf(existing, paths.pdfPath);
                  updated = { ...existing, pdfPath: paths.pdfPath, pdfSource: 'local' };
                  dirtyRecords.push(updated);
                  didDownloadNew = true;
                } catch {
                  state.failed++;
                  state.processed++;
                  state.errors.push({
                    claveAcceso: clave,
                    reason: pdfRes.reason || 'No se pudo obtener el PDF original del SRI.',
                  });
                  emit();
                  continue;
                }
              }
            }
          }

          collectedForExcel.push(updated);
          if (didDownloadNew) state.downloaded++;
          else state.skipped++;
          state.processed++;
          emit();
          continue;
        }

        try {
          let authorizedXmlText = '';
          let innerXmlForParser = '';
          let authEstado = 'AUTORIZADO';
          let authFecha = entry.fechaAutorizacion || '';
          let authAmbiente = 'PRODUCCIÓN';

          // 1. Try fast official SOAP API first (ideal for recent months)
          const auth = await fetchAuthorizedXmlFromSri(clave, {
            retries: 3,
            timeoutMs: 18_000,
            signal: abortController.signal,
          });

          if (auth.ok) {
            authorizedXmlText = auth.authorizedWrapperXml;
            innerXmlForParser = auth.innerXml;
            authEstado = auth.estado;
            authFecha = auth.fechaAutorizacion;
            authAmbiente = auth.ambiente;
          } else if (this.originalXmlFetcher) {
            // 2. Fallback for historical months (e.g. > 90 days old): fetch the 100% original XML directly from SRI portal `lnkXml`!
            const portalXml = await this.originalXmlFetcher({
              claveAcceso: clave,
              rowIndex: entry.rowIndex,
              numeroComprobante: decoded?.numeroComprobante || entry.serieComprobante,
              rucEmisor: decoded?.rucEmisor || entry.rucEmisor,
              signal: abortController.signal,
            });
            if (portalXml.ok && portalXml.buffer) {
              authorizedXmlText = portalXml.buffer.toString('utf-8');
              innerXmlForParser = authorizedXmlText;
            } else {
              state.failed++;
              state.processed++;
              state.errors.push({
                claveAcceso: clave,
                reason: portalXml.reason || auth.errorMessage || `Estado: ${auth.estado}`,
              });
              emit();
              continue;
            }
          } else {
            state.failed++;
            state.processed++;
            state.errors.push({
              claveAcceso: clave,
              reason: auth.errorMessage || `Estado: ${auth.estado}`,
            });
            emit();
            continue;
          }

          // Parse XML first so we always know the official Razón Social Emisor for folder organization
          const parsed = parseSriComprobanteXml({
            innerXml: innerXmlForParser,
            profileId: profile.id,
            ownerRuc: profile.ruc,
            xmlPath: '',
            estado: authEstado,
            fechaAutorizacion: authFecha,
            ambiente: authAmbiente,
          });

          // Never silently overwrite another comprobante or miscount if SRI returned a mismatched XML
          if (parsed.claveAcceso && parsed.claveAcceso !== clave) {
            state.failed++;
            state.processed++;
            state.errors.push({
              claveAcceso: clave,
              reason: `El SRI devolvió un XML distinto (${parsed.claveAcceso.slice(-12)}) al solicitado.`,
            });
            emit();
            continue;
          }

          const paths = buildComprobantePaths({
            outputDir: settings.outputDir,
            ownerRuc: profile.ruc,
            ownerAlias: profile.alias,
            year: yearSeg,
            month: docMonthNum,
            rucEmisor: parsed.rucEmisor || decoded?.rucEmisor || '',
            razonSocialEmisor: parsed.razonSocialEmisor || entry.razonSocialEmisor || '',
            tipoCodigo: parsed.tipoCodigo,
            fechaEmisionIso: parsed.fechaEmisionIso,
            numeroComprobante: parsed.numeroComprobante,
            claveAcceso: clave,
          });

          if (formats.xml) {
            ensureDir(paths.xmlDir);
            await fs.promises.writeFile(paths.xmlPath, authorizedXmlText, 'utf-8');
            parsed.xmlPath = paths.xmlPath;
          } else if (hasXmlOnDisk && existing?.xmlPath) {
            parsed.xmlPath = existing.xmlPath;
          }

          if (formats.pdf) {
            if (hasOriginalSriPdfOnDisk && existing?.pdfPath) {
              parsed.pdfPath = existing.pdfPath;
              parsed.pdfSource = 'sri';
            } else {
              let gotOriginalPdf = false;
              let sriPdfReason = '';
              if (this.originalPdfFetcher) {
                const pdfRes = await this.originalPdfFetcher({
                  claveAcceso: clave,
                  rowIndex: entry.rowIndex,
                  numeroComprobante: parsed.numeroComprobante || decoded?.numeroComprobante,
                  rucEmisor: parsed.rucEmisor || decoded?.rucEmisor || entry.rucEmisor,
                  signal: abortController.signal,
                });
                if (pdfRes.ok && pdfRes.buffer) {
                  ensureDir(paths.pdfDir);
                  await fs.promises.writeFile(paths.pdfPath, pdfRes.buffer);
                  parsed.pdfPath = paths.pdfPath;
                  parsed.pdfSource = 'sri';
                  gotOriginalPdf = true;
                } else {
                  sriPdfReason = pdfRes.reason || 'no disponible';
                }
              }

              if (!gotOriginalPdf && !abortController.signal.aborted) {
                // Automatic fallback: generate local RIDE PDF from the authorized XML when SRI refuses to render this document
                try {
                  ensureDir(paths.pdfDir);
                  await generateRidePdf(parsed, paths.pdfPath);
                  parsed.pdfPath = paths.pdfPath;
                  parsed.pdfSource = 'local';
                } catch (rideErr) {
                  state.errors.push({
                    claveAcceso: clave,
                    reason: `PDF original SRI: ${sriPdfReason || 'no disponible'} (RIDE local: ${
                      rideErr instanceof Error ? rideErr.message : String(rideErr)
                    })`,
                  });
                }
              }
            }
          } else if (hasOriginalSriPdfOnDisk && existing?.pdfPath) {
            parsed.pdfPath = existing.pdfPath;
            parsed.pdfSource = 'sri';
          }

          dirtyRecords.push(parsed);
          collectedForExcel.push(parsed);
          state.downloaded++;
          state.processed++;

          if (dirtyRecords.length >= 50) {
            this.store.upsertComprobantes(dirtyRecords.splice(0, dirtyRecords.length));
          }
          emit();
        } catch (err) {
          if (abortController.signal.aborted) break;
          state.failed++;
          state.processed++;
          state.errors.push({
            claveAcceso: clave,
            reason: err instanceof Error ? err.message : String(err),
          });
          emit();
        }
      }
    };

    try {
      const workerCount = Math.min(settings.concurrency, Math.max(1, queue.length));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (dirtyRecords.length > 0) {
        this.store.upsertComprobantes(dirtyRecords);
      }

      if (abortController.signal.aborted) {
        state.status = 'cancelled';
      } else {
        if (formats.excel && collectedForExcel.length > 0) {
          ensureDir(excelFolder);
          const excelName = `Faktum_Resumen_${profile.ruc}_${periodYear}-${String(monthNum).padStart(2, '0')}.xlsx`;
          const excelPath = path.join(excelFolder, excelName);
          await exportComprobantesToExcel(collectedForExcel, excelPath);
          state.excelPath = excelPath;
        }
        this.store.touchProfileSync(profile.id);
        state.status = 'completed';
      }
    } catch (err) {
      state.status = 'error';
      state.errors.push({
        claveAcceso: 'GENERAL',
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.isRunning = false;
      this.activeAbortController = null;
      state.currentKey = undefined;
      state.currentEmitter = undefined;
      emit(true);
    }

    return {
      ...state,
      collected: collectedForExcel,
    };
  }
}
