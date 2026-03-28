const handler = require('./api/tariff-reference.js');

function runCase(payload) {
  return new Promise((resolve) => {
    const req = { method: 'POST', body: payload };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ statusCode: this.statusCode, data }); return this; },
    };
    handler(req, res).catch((error) => {
      resolve({ statusCode: 500, data: { ok: false, error: String(error?.message || error) } });
    });
  });
}

(async () => {
  const cases = [
    { label: 'strom', payload: { postalCode: '10115', sector: 'strom', consumption: 3500, customerType: 'Privat' } },
    { label: 'gas', payload: { postalCode: '10115', sector: 'gas', consumption: 12000, customerType: 'Privat' } },
  ];

  for (const testCase of cases) {
    const result = await runCase(testCase.payload);
    console.log('\n=== ' + testCase.label.toUpperCase() + ' ===');
    console.log('status:', result.statusCode);
    console.log(JSON.stringify(result.data, null, 2));
  }
})();
