import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  ParsedComprobante,
  RucProfile,
  RucProfileInput,
} from '../../shared/types';

interface StoredProfileRecord {
  id: string;
  ruc: string;
  alias: string;
  passwordEncryptedBase64?: string;
  passwordPlainFallback?: string;
  createdAt: string;
  lastSyncAt?: string;
}

interface HistoryIndex {
  comprobantes: Record<string, ParsedComprobante>;
}

export class FaktumStore {
  private readonly baseDir: string;
  private readonly profilesPath: string;
  private readonly settingsPath: string;
  private readonly historyPath: string;
  private historyCache: HistoryIndex | null = null;

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir ?? path.join(app.getPath('userData'), 'faktum-data');
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.profilesPath = path.join(this.baseDir, 'profiles.json');
    this.settingsPath = path.join(this.baseDir, 'settings.json');
    this.historyPath = path.join(this.baseDir, 'history.json');
  }

  private readJson<T>(filePath: string, fallback: T): T {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(filePath: string, data: unknown): void {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  public isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private encryptSecret(secret: string): { encrypted?: string; fallback?: string } {
    if (this.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(secret);
      return { encrypted: buf.toString('base64') };
    }
    return { fallback: secret };
  }

  private decryptSecret(record: StoredProfileRecord): string | null {
    if (record.passwordEncryptedBase64 && this.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(record.passwordEncryptedBase64, 'base64'));
      } catch {
        return null;
      }
    }
    if (record.passwordPlainFallback) {
      return record.passwordPlainFallback;
    }
    return null;
  }

  private readProfileRecords(): StoredProfileRecord[] {
    return this.readJson<StoredProfileRecord[]>(this.profilesPath, []);
  }

  public listProfiles(): RucProfile[] {
    return this.readProfileRecords().map((r) => ({
      id: r.id,
      ruc: r.ruc,
      alias: r.alias,
      hasPassword: Boolean(r.passwordEncryptedBase64 || r.passwordPlainFallback),
      createdAt: r.createdAt,
      lastSyncAt: r.lastSyncAt,
    }));
  }

  public getProfileWithPassword(id: string): { profile: RucProfile; password: string | null } | null {
    const record = this.readProfileRecords().find((r) => r.id === id);
    if (!record) return null;
    return {
      profile: {
        id: record.id,
        ruc: record.ruc,
        alias: record.alias,
        hasPassword: Boolean(record.passwordEncryptedBase64 || record.passwordPlainFallback),
        createdAt: record.createdAt,
        lastSyncAt: record.lastSyncAt,
      },
      password: this.decryptSecret(record),
    };
  }

  public saveProfile(input: RucProfileInput): RucProfile {
    const cleanRuc = input.ruc.replace(/\D/g, '');
    if (!/^\d{13}$/.test(cleanRuc)) {
      throw new Error('El RUC debe tener exactamente 13 dígitos numéricos.');
    }
    const cleanAlias = input.alias.trim();
    if (!cleanAlias) {
      throw new Error('Ingresa un nombre o razón social para identificar este RUC.');
    }

    const records = this.readProfileRecords();
    const existingIndex = input.id
      ? records.findIndex((r) => r.id === input.id)
      : records.findIndex((r) => r.ruc === cleanRuc);

    if (existingIndex >= 0) {
      const existing = records[existingIndex];
      const updated: StoredProfileRecord = {
        ...existing,
        ruc: cleanRuc,
        alias: cleanAlias,
      };
      if (input.password && input.password.length > 0) {
        const enc = this.encryptSecret(input.password);
        updated.passwordEncryptedBase64 = enc.encrypted;
        updated.passwordPlainFallback = enc.fallback;
      }
      records[existingIndex] = updated;
      this.writeJson(this.profilesPath, records);
      return {
        id: updated.id,
        ruc: updated.ruc,
        alias: updated.alias,
        hasPassword: Boolean(updated.passwordEncryptedBase64 || updated.passwordPlainFallback),
        createdAt: updated.createdAt,
        lastSyncAt: updated.lastSyncAt,
      };
    }

    const newRecord: StoredProfileRecord = {
      id: crypto.randomUUID(),
      ruc: cleanRuc,
      alias: cleanAlias,
      createdAt: new Date().toISOString(),
    };

    if (input.password && input.password.length > 0) {
      const enc = this.encryptSecret(input.password);
      newRecord.passwordEncryptedBase64 = enc.encrypted;
      newRecord.passwordPlainFallback = enc.fallback;
    }

    records.push(newRecord);
    this.writeJson(this.profilesPath, records);

    return {
      id: newRecord.id,
      ruc: newRecord.ruc,
      alias: newRecord.alias,
      hasPassword: Boolean(newRecord.passwordEncryptedBase64 || newRecord.passwordPlainFallback),
      createdAt: newRecord.createdAt,
    };
  }

  public touchProfileSync(id: string): void {
    const records = this.readProfileRecords();
    const idx = records.findIndex((r) => r.id === id);
    if (idx >= 0) {
      records[idx].lastSyncAt = new Date().toISOString();
      this.writeJson(this.profilesPath, records);
    }
  }

  public deleteProfile(id: string): void {
    const records = this.readProfileRecords().filter((r) => r.id !== id);
    this.writeJson(this.profilesPath, records);
  }

  public getSettings(): AppSettings {
    const defaultOutputDir = path.join(app.getPath('documents'), 'Faktum_SRI');
    const saved = this.readJson<Partial<AppSettings>>(this.settingsPath, {});
    return {
      outputDir: saved.outputDir || defaultOutputDir,
      concurrency:
        typeof saved.concurrency === 'number'
          ? Math.min(20, Math.max(1, saved.concurrency))
          : 10,
      autoExportExcel: saved.autoExportExcel ?? true,
      defaultDownloadXml: saved.defaultDownloadXml ?? true,
      defaultDownloadPdf: saved.defaultDownloadPdf ?? true,
      autoTriggerReportAfterSearch: saved.autoTriggerReportAfterSearch ?? true,
    };
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const next: AppSettings = {
      ...current,
      ...partial,
      concurrency:
        partial.concurrency !== undefined
          ? Math.min(20, Math.max(1, Math.round(partial.concurrency)))
          : current.concurrency,
    };
    this.writeJson(this.settingsPath, next);
    return next;
  }

  private readHistory(): HistoryIndex {
    if (!this.historyCache) {
      this.historyCache = this.readJson<HistoryIndex>(this.historyPath, { comprobantes: {} });
    }
    return this.historyCache;
  }

  public getComprobanteByKey(claveAcceso: string): ParsedComprobante | null {
    return this.readHistory().comprobantes[claveAcceso] ?? null;
  }

  public hasDownloadedComprobante(claveAcceso: string): ParsedComprobante | null {
    const existing = this.readHistory().comprobantes[claveAcceso];
    if (!existing) return null;
    const hasXml = Boolean(existing.xmlPath && fs.existsSync(existing.xmlPath));
    const hasPdf = Boolean(existing.pdfPath && fs.existsSync(existing.pdfPath));
    if (hasXml || hasPdf) {
      return existing;
    }
    return null;
  }

  public upsertComprobantes(items: ParsedComprobante[]): void {
    if (items.length === 0) return;
    const history = this.readHistory();
    for (const item of items) {
      history.comprobantes[item.claveAcceso] = item;
    }
    this.writeJson(this.historyPath, history);
  }

  public listComprobantes(filter?: {
    profileId?: string;
    year?: number;
    month?: number;
    tipoCodigo?: string;
    search?: string;
  }): ParsedComprobante[] {
    const history = this.readHistory();
    let list = Object.values(history.comprobantes);

    if (filter?.profileId && filter.profileId !== 'ALL') {
      list = list.filter((c) => c.profileId === filter.profileId);
    }
    if (filter?.year) {
      const yStr = String(filter.year);
      list = list.filter((c) => c.fechaEmisionIso.startsWith(yStr));
    }
    if (filter?.month) {
      const mStr = `-${String(filter.month).padStart(2, '0')}-`;
      list = list.filter((c) => c.fechaEmisionIso.includes(mStr));
    }
    if (filter?.tipoCodigo && filter.tipoCodigo !== 'ALL') {
      list = list.filter((c) => c.tipoCodigo === filter.tipoCodigo);
    }
    if (filter?.search && filter.search.trim().length > 0) {
      const q = filter.search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.razonSocialEmisor.toLowerCase().includes(q) ||
          c.rucEmisor.includes(q) ||
          c.numeroComprobante.toLowerCase().includes(q) ||
          c.claveAcceso.includes(q)
      );
    }

    return list.sort((a, b) => b.fechaEmisionIso.localeCompare(a.fechaEmisionIso));
  }

  public getComprobantesByKeys(keys: string[]): ParsedComprobante[] {
    const history = this.readHistory();
    return keys
      .map((k) => history.comprobantes[k])
      .filter((item): item is ParsedComprobante => Boolean(item));
  }

  public deleteComprobanteRecord(claveAcceso: string): void {
    const history = this.readHistory();
    delete history.comprobantes[claveAcceso];
    this.writeJson(this.historyPath, history);
  }
}
