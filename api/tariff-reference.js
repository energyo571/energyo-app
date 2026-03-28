const DEFAULT_BASE_URL = process.env.TARIFKALKULATOR_BASE_URL || "https://stromundgasportal.de";

const REF_PRODUCTS = {
  privat: {
    strom: [
      { reseller: "lichtblick", service: "okostrom24" },
      { reseller: "lichtblick", service: "okostrom 24" },
    ],
    gas: [
      { reseller: "lichtblick", service: "gas relax 24" },
      { reseller: "lichtblick", service: "gasrelax24" },
    ],
  },
  business: {
    strom: [
      { reseller: "vattenfall", service: "profi okostrom24 l" },
      { reseller: "vattenfall", service: "profi okostrom 24 l" },
    ],
    gas: [
      { reseller: "ewe", service: "business gas" },
      { reseller: "ewe", service: "ewe business gas" },
    ],
  },
};

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ä]/g, "ae")
    .replace(/[ö]/g, "oe")
    .replace(/[ü]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function parseHidden(html, name) {
  const regex = new RegExp(`name=\"${name.replace(/[\\[\\]]/g, "\\$&")}\"[^>]*value=\"([^\"]*)\"`, "i");
  const match = String(html || "").match(regex);
  return match ? match[1] : "";
}

function getCookie(res) {
  return res.headers.get("set-cookie") || "";
}

function mergeCookies(current, incoming) {
  if (!incoming) return current || "";
  const jar = new Map();
  const all = [current || "", incoming || ""].join("; ").split(/;\s*/);
  for (const part of all) {
    if (!part || !part.includes("=")) continue;
    const [k, v] = part.split("=");
    if (!k || !v) continue;
    if (["Path", "Expires", "Secure", "HttpOnly", "SameSite", "Domain", "Max-Age"].includes(k)) continue;
    jar.set(k.trim(), v.trim());
  }
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function requestWithFallback(url, cookie, payload) {
  const attempts = [
    {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(payload),
    },
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams(Object.entries(payload).map(([k, v]) => [k, String(v ?? "")])).toString(),
    },
  ];

  for (const attempt of attempts) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...attempt.headers,
        Cookie: cookie,
        Referer: `${DEFAULT_BASE_URL}/tk/`,
      },
      body: attempt.body,
    });

    const raw = await response.text();
    const parsed = parseJsonSafe(raw);
    if (response.ok && parsed && parsed.result) return parsed;
  }

  return null;
}

function pickReferenceService(services, customerGroup, sector) {
  const list = Array.isArray(services) ? services : [];
  const candidates = REF_PRODUCTS[customerGroup]?.[sector] || [];
  if (!candidates.length) return null;

  const scored = list.map((service) => {
    const reseller = normalize(service?.reseller_name);
    const name = normalize(service?.service_name);

    let score = 0;
    for (const candidate of candidates) {
      if (reseller.includes(candidate.reseller)) score += 2;
      if (name.includes(normalize(candidate.service))) score += 5;
    }

    return { service, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].service : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const password = process.env.TARIFKALKULATOR_PASSWORD;
  if (!password) {
    return res.status(500).json({ ok: false, error: "TARIFKALKULATOR_PASSWORD not configured" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const postalCode = String(body.postalCode || "").trim();
    const sector = String(body.sector || "").trim().toLowerCase();
    const consumption = Number.parseFloat(body.consumption);
    const customerType = String(body.customerType || "Privat").trim().toLowerCase();

    if (!postalCode || !["strom", "gas"].includes(sector) || !Number.isFinite(consumption) || consumption <= 0) {
      return res.status(400).json({ ok: false, error: "postalCode, sector (strom|gas) and consumption are required" });
    }

    const customerGroup = customerType === "privat" ? "privat" : "business";
    const companyService = customerGroup === "business" ? "1" : "0";

    let cookie = "";

    const loginPage = await fetch(`${DEFAULT_BASE_URL}/tk/`, { method: "GET" });
    cookie = mergeCookies(cookie, getCookie(loginPage));
    const html = await loginPage.text();
    const csrf = parseHidden(html, "_csrf_token");
    const token = parseHidden(html, "form[_token]");

    const loginPayload = new URLSearchParams();
    loginPayload.set("form[password]", password);
    if (csrf) loginPayload.set("_csrf_token", csrf);
    if (token) loginPayload.set("form[_token]", token);

    const loginRes = await fetch(`${DEFAULT_BASE_URL}/tk/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Referer: `${DEFAULT_BASE_URL}/tk/`,
      },
      body: loginPayload.toString(),
      redirect: "manual",
    });
    cookie = mergeCookies(cookie, getCookie(loginRes));

    const searcharea = await requestWithFallback(`${DEFAULT_BASE_URL}/api/calculator/searcharea`, cookie, {
      postalCode,
      sector,
      consumption,
      consumptionNt: null,
      companyService,
      futureBaseSuppliers: false,
    });

    if (!searcharea?.result?.length) {
      return res.status(502).json({ ok: false, error: "No postal-code area found from calculator API" });
    }

    const pca = searcharea.result[0];
    const pcaId = pca.pca_id || pca.id || pca.postalCodeAreaId;
    if (!pcaId) {
      return res.status(502).json({ ok: false, error: "postalCodeAreaId missing in calculator response" });
    }

    const showservices = await requestWithFallback(`${DEFAULT_BASE_URL}/api/calculator/showservices`, cookie, {
      postalCodeAreaId: pcaId,
      base_supplier_id: "0",
      sector,
      consumption,
      consumptionNt: null,
      companyService,
      futureBaseSuppliers: false,
    });

    const services = showservices?.result || [];
    if (!services.length) {
      return res.status(502).json({ ok: false, error: "No services returned by calculator API" });
    }

    const refService = pickReferenceService(services, customerGroup, sector);
    if (!refService) {
      return res.status(404).json({ ok: false, error: "Reference tariff not found in current result set", count: services.length });
    }

    return res.status(200).json({
      ok: true,
      sector,
      customerGroup,
      reference: {
        resellerName: refService.reseller_name || "",
        serviceName: refService.service_name || "",
        workingPriceCt: Number.parseFloat(refService.working_price || 0) || 0,
        basePriceEurYear: Number.parseFloat(refService.base_price || 0) || 0,
        totalCostEurYear: Number.parseFloat(refService.total_cost_minus_bonuses || refService.total_cost || 0) || 0,
      },
      meta: {
        pcaId,
        postalCode,
        consumption,
        totalServices: services.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "tariff-reference failed", detail: error?.message || String(error) });
  }
};
