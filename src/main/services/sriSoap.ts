import { XMLParser } from 'fast-xml-parser';

const SRI_PROD_AUTH_URL =
  'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline';

export interface SriAuthorizationResult {
  ok: boolean;
  estado: string;
  numeroAutorizacion: string;
  fechaAutorizacion: string;
  ambiente: string;
  innerXml: string;
  authorizedWrapperXml: string;
  errorMessage?: string;
}

const soapParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});

function buildSoapEnvelope(claveAcceso: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">
  <soapenv:Header/>
  <soapenv:Body>
    <ec:autorizacionComprobante>
      <claveAccesoComprobante>${claveAcceso}</claveAccesoComprobante>
    </ec:autorizacionComprobante>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function unescapeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function buildAuthorizedWrapperXml(params: {
  estado: string;
  numeroAutorizacion: string;
  fechaAutorizacion: string;
  ambiente: string;
  innerXml: string;
}): string {
  const safeInner = params.innerXml.replace(/]]>/g, ']]]]><![CDATA[>');
  return `<?xml version="1.0" encoding="UTF-8"?>
<autorizacion>
  <estado>${params.estado}</estado>
  <numeroAutorizacion>${params.numeroAutorizacion}</numeroAutorizacion>
  <fechaAutorizacion>${params.fechaAutorizacion}</fechaAutorizacion>
  <ambiente>${params.ambiente}</ambiente>
  <comprobante><![CDATA[${safeInner}]]></comprobante>
</autorizacion>
`;
}

export function parseSriSoapResponse(soapXml: string, claveAcceso: string): SriAuthorizationResult {
  const parsed = soapParser.parse(soapXml);
  const body = parsed?.Envelope?.Body;
  const resp =
    body?.autorizacionComprobanteResponse?.RespuestaAutorizacionComprobante ??
    body?.autorizacionComprobanteResponse?.return;

  if (!resp) {
    return {
      ok: false,
      estado: 'ERROR',
      numeroAutorizacion: claveAcceso,
      fechaAutorizacion: '',
      ambiente: '',
      innerXml: '',
      authorizedWrapperXml: '',
      errorMessage: 'Respuesta SOAP inesperada del SRI.',
    };
  }

  let autorizaciones = resp?.autorizaciones?.autorizacion;
  if (!autorizaciones) {
    return {
      ok: false,
      estado: 'NO ENCONTRADO',
      numeroAutorizacion: claveAcceso,
      fechaAutorizacion: '',
      ambiente: '',
      innerXml: '',
      authorizedWrapperXml: '',
      errorMessage: 'El SRI no devolvió autorizaciones para esta clave de acceso.',
    };
  }

  if (!Array.isArray(autorizaciones)) {
    autorizaciones = [autorizaciones];
  }

  // Prefer the AUTORIZADO record when multiple authorization attempts exist
  const chosen =
    autorizaciones.find((a: Record<string, unknown>) => String(a?.estado ?? '').trim() === 'AUTORIZADO') ??
    autorizaciones[0];

  const estado = String(chosen?.estado ?? '').trim();
  const numeroAutorizacion = String(chosen?.numeroAutorizacion ?? claveAcceso).trim();
  const fechaAutorizacion = String(chosen?.fechaAutorizacion ?? '').trim();
  const ambiente = String(chosen?.ambiente ?? 'PRODUCCIÓN').trim();
  let rawComprobante = typeof chosen?.comprobante === 'string' ? chosen.comprobante.trim() : '';

  if (rawComprobante.startsWith('&lt;')) {
    rawComprobante = unescapeXmlEntities(rawComprobante);
  }

  if (estado !== 'AUTORIZADO' || !rawComprobante) {
    const msgs = chosen?.mensajes?.mensaje;
    const msgList = Array.isArray(msgs) ? msgs : msgs ? [msgs] : [];
    const detail = msgList
      .map((m: Record<string, unknown>) => [m?.mensaje, m?.informacionAdicional].filter(Boolean).join(': '))
      .join(' | ');
    return {
      ok: false,
      estado: estado || 'NO AUTORIZADO',
      numeroAutorizacion,
      fechaAutorizacion,
      ambiente,
      innerXml: rawComprobante,
      authorizedWrapperXml: '',
      errorMessage: detail || `Comprobante con estado ${estado || 'desconocido'}.`,
    };
  }

  const authorizedWrapperXml = buildAuthorizedWrapperXml({
    estado,
    numeroAutorizacion,
    fechaAutorizacion,
    ambiente,
    innerXml: rawComprobante,
  });

  return {
    ok: true,
    estado,
    numeroAutorizacion,
    fechaAutorizacion,
    ambiente,
    innerXml: rawComprobante,
    authorizedWrapperXml,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchAuthorizedXmlFromSri(
  claveAcceso: string,
  options?: { retries?: number; timeoutMs?: number; signal?: AbortSignal }
): Promise<SriAuthorizationResult> {
  const retries = options?.retries ?? 3;
  const timeoutMs = options?.timeoutMs ?? 20_000;
  let lastError = 'Error desconocido al consultar el SRI.';

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (options?.signal?.aborted) {
      throw new Error('Descarga cancelada por el usuario.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await fetch(SRI_PROD_AUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: '""',
        },
        body: buildSoapEnvelope(claveAcceso),
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status} del Web Service del SRI.`;
        if (attempt < retries) {
          await sleep(300 * attempt);
          continue;
        }
      } else {
        const xmlText = await response.text();
        const result = parseSriSoapResponse(xmlText, claveAcceso);
        if (result.ok || result.estado === 'NO AUTORIZADO') {
          return result;
        }
        lastError = result.errorMessage ?? lastError;
        if (attempt < retries) {
          await sleep(350 * attempt);
          continue;
        }
        return result;
      }
    } catch (err) {
      if (options?.signal?.aborted) {
        throw new Error('Descarga cancelada por el usuario.');
      }
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        await sleep(400 * attempt);
      }
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onParentAbort);
    }
  }

  return {
    ok: false,
    estado: 'ERROR',
    numeroAutorizacion: claveAcceso,
    fechaAutorizacion: '',
    ambiente: '',
    innerXml: '',
    authorizedWrapperXml: '',
    errorMessage: lastError,
  };
}
