import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getBiblionumber(record) {
  const fields = asArray(record.controlfield);

  const field001 = fields.find(
    f => f["@_tag"] === "001"
  );

  if (field001 && field001["#text"]) {
    return String(field001["#text"]).trim();
  }

  const datafields = asArray(record.datafield);

  const field999 = datafields.find(
    f => f["@_tag"] === "999"
  );

  if (field999) {
    const subfields = asArray(field999.subfield);

    const subfieldC = subfields.find(
      f => f["@_code"] === "c"
    );

    if (subfieldC && subfieldC["#text"]) {
      return String(subfieldC["#text"]).trim();
    }
  }

  return null;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8"
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders
      });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method !== "GET") {
      return json({ error: "Méthode non autorisée" }, 405);
    }

    const url = new URL(request.url);
    const isbn = url.searchParams.get("isbn");
    const issn = url.searchParams.get("issn");

    if ((!isbn && !issn) || (isbn && issn)) {
      return json({
        error: "Fournir un ISBN ou un ISSN"
      }, 400);
    }

    const identifier = (isbn || issn).trim();

    if (!/^[0-9Xx-]+$/.test(identifier)) {
      return json({ error: "Identifiant invalide" }, 400);
    }

    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit")) || 5, 1),
      20
    );

    try {
      const sruUrl = new URL(env.SRU_URL);

      sruUrl.searchParams.set("version", "1.1");
      sruUrl.searchParams.set("operation", "searchRetrieve");
      sruUrl.searchParams.set("query", identifier);
      sruUrl.searchParams.set("maximumRecords", limit);
      sruUrl.searchParams.set("recordSchema", "marcxml");

      const response = await fetch(sruUrl, {
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return json({
          error: "Erreur du serveur SRU"
        }, 502);
      }

      const xml = await response.text();
      const data = parser.parse(xml);

      const sru = data.searchRetrieveResponse;

      if (!sru) {
        return json({ error: "Réponse SRU invalide" }, 502);
      }

      const records = asArray(sru.records?.record);

      const notices = records
        .map(item => {
          const marc = item.recordData?.record;

          if (!marc) return null;

          const biblionumber = getBiblionumber(marc);

          if (!biblionumber) return null;

          return {
            biblionumber,
            opac_url:
              `${env.OPAC_URL}?biblionumber=${encodeURIComponent(biblionumber)}`
          };
        })
        .filter(Boolean);

      return json({
        success: true,
        identifier,
        count: notices.length,
        total: Number(sru.numberOfRecords || 0),
        notices
      });

    } catch (error) {
      return json({
        success: false,
        error: "Impossible d'interroger Koha"
      }, 502);
    }
  }
};