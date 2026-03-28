const io = require("socket.io-client");

const DEFAULT_BASE_URL = process.env.TARIFKALKULATOR_BASE_URL || "https://tarifrechner.software";
const DEFAULT_SERVICE_ROOT_PATH = process.env.TARIFKALKULATOR_SERVICE_ROOT_PATH || "whitelabel";
const DEFAULT_WHITELABEL_ID = process.env.TARIFKALKULATOR_WHITELABEL_ID || "34ec3a70-d7d4-11ef-982f-df6ea12393d2";
const DEFAULT_COUNTRY = process.env.TARIFKALKULATOR_COUNTRY || "de";
const DEFAULT_COUNTRY_CODE = process.env.TARIFKALKULATOR_COUNTRY_CODE || "81";
const DEFAULT_HOUSE_NUMBER = process.env.TARIFKALKULATOR_HOUSE_NUMBER || "1";

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
     .replace(/[\u00e4]/g, "ae")
     .replace(/[\u00f6]/g, "oe")
     .replace(/[\u00fc]/g, "ue")
     .replace(/\u00df/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function buildBasePath(serviceRootPath) {
  const root = trimSlashes(serviceRootPath);
  return root ? `/${root}` : "";
}

async function fetchJson(url) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`GET failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function resolveAddress({
  baseUrl,
  serviceRootPath,
  whitelabelId,
  postalCode,
  country,
}) {
  const pathPrefix = buildBasePath(serviceRootPath);
  const middlewareBase = `${baseUrl}${pathPrefix}/middleware/middleware`;

  const citiesUrl = `${middlewareBase}/cities?id=${encodeURIComponent(whitelabelId)}&zip=${encodeURIComponent(postalCode)}&country=${encodeURIComponent(country)}`;
  const citiesPayload = await fetchJson(citiesUrl);
  const cities = Array.isArray(citiesPayload?.data?.result) ? citiesPayload.data.result : [];
  const city = String(cities[0]?.city || "").trim();
  if (!city) {
    throw new Error("No city found for postal code");
  }

  const streetsUrl = `${middlewareBase}/streets?id=${encodeURIComponent(whitelabelId)}&zip=${encodeURIComponent(postalCode)}&city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}`;
  const streetsPayload = await fetchJson(streetsUrl);
  const streets = Array.isArray(streetsPayload?.data?.result) ? streetsPayload.data.result : [];
  const street = String(streets[0]?.street || "").trim();
  if (!street) {
    throw new Error("No street found for postal code and city");
  }

  return { city, street };
}

function connectSocket({ baseUrl, serviceRootPath }) {
  const pathPrefix = buildBasePath(serviceRootPath);
  return io(baseUrl, {
    path: `${pathPrefix}/socket.io`,
    transports: ["websocket", "polling"],
    timeout: 20000,
    reconnection: false,
    forceNew: true,
  });
}

async function requestRatecalc({
  baseUrl,
  serviceRootPath,
  payload,
}) {
  const socket = connectSocket({ baseUrl, serviceRootPath });

  try {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Socket connect timeout")), 20000);
        const onConnect = () => {
          clearTimeout(timer);
          resolve();
        };
        const onError = (err) => {
          clearTimeout(timer);
          reject(err);
        };

        socket.on("connect", onConnect);
        socket.on("connect_error", onError);
        socket.on("error", onError);
    });

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ratecalc response timeout")), 25000);

      socket.emit("ratecalc", payload, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });

    if (result?.error) {
      const detail = result?.data?.message || "Unknown ratecalc error";
      throw new Error(detail);
    }

    return Array.isArray(result?.result) ? result.result : [];
  } finally {
    socket.close();
  }
}

function pickReferenceService(services, customerGroup, sector) {
  const list = Array.isArray(services) ? services : [];
  if (!list.length) return null;

  // Sortiere alle Tarife nach Gesamtpreis (totalPrice, total_cost_minus_bonuses, total_cost)
  const sorted = list.slice().sort((a, b) => {
    const priceA = Number.parseFloat(a.totalPrice || a.total_cost_minus_bonuses || a.total_cost || 0) || 0;
    const priceB = Number.parseFloat(b.totalPrice || b.total_cost_minus_bonuses || b.total_cost || 0) || 0;
    return priceA - priceB;
  });

  // Nimm den drittgünstigsten, falls vorhanden, sonst den günstigsten
  if (sorted.length >= 3) {
    return sorted[2];
  } else {
    return sorted[0];
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
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
    const branch = sector === "strom" ? "electric" : "gas";
    const type = customerGroup === "privat" ? "private" : "company";

    const baseUrl = String(DEFAULT_BASE_URL).replace(/\/+$/, "");
    const serviceRootPath = trimSlashes(DEFAULT_SERVICE_ROOT_PATH);
    const whitelabelId = DEFAULT_WHITELABEL_ID;
    const country = String(DEFAULT_COUNTRY || "de").trim().toLowerCase() || "de";
    const countryCode = String(body.countryCode || DEFAULT_COUNTRY_CODE || "81").trim() || "81";

    const { city, street } = await resolveAddress({
      baseUrl,
      serviceRootPath,
      whitelabelId,
      postalCode,
      country,
    });

    const socketPayload = {
      id: whitelabelId,
      branch,
      type,
      country: countryCode,
      zip: postalCode,
      city,
      street,
      houseNumber: String(DEFAULT_HOUSE_NUMBER || "1"),
      consum: consumption,
      filtervar: [],
    };

    if (branch === "electric") {
      socketPayload.consumNt = 0;
      socketPayload.VarFilters = [];
    }

    const services = await requestRatecalc({
      baseUrl,
      serviceRootPath,
      payload: socketPayload,
    });

    if (!services.length) {
      return res.status(502).json({ ok: false, error: "No services returned by ratecalc socket API" });
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
        resellerName: refService.providerName || refService.reseller_name || "",
        serviceName: refService.rateName || refService.service_name || "",
        workingPriceCt: Number.parseFloat(refService.workPrice || refService.working_price || 0) || 0,
        basePriceEurYear: Number.parseFloat(refService.basePriceYear || refService.base_price || 0) || 0,
        totalCostEurYear: Number.parseFloat(refService.totalPrice || refService.total_cost_minus_bonuses || refService.total_cost || 0) || 0,
      },
      meta: {
        branch,
        type,
        city,
        street,
        country,
        countryCode,
        postalCode,
        consumption,
        totalServices: services.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "tariff-reference failed", detail: error?.message || String(error) });
  }
};
