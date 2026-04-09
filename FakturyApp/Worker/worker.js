export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {
      if (url.pathname === "/api/health") {
        return jsonResponse(
          {
            ok: true,
            message: "Worker beží správne",
            time: new Date().toISOString()
          },
          200,
          corsHeaders
        );
      }

      if (url.pathname === "/api/init" && request.method === "POST") {
        await env.FAKTURY_DB.prepare(`
          CREATE TABLE IF NOT EXISTS companies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `).run();

        await env.FAKTURY_DB.prepare(`
          CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `).run();

        await env.FAKTURY_DB.prepare(`
          CREATE TABLE IF NOT EXISTS invoices (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            invoice_number TEXT,
            customer_name TEXT,
            issued_date TEXT,
            due_date TEXT,
            total REAL DEFAULT 0,
            due REAL DEFAULT 0,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `).run();

        await env.FAKTURY_DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_customers_company_id
          ON customers(company_id)
        `).run();

        await env.FAKTURY_DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_invoices_company_id
          ON invoices(company_id)
        `).run();

        await env.FAKTURY_DB.prepare(`
          CREATE INDEX IF NOT EXISTS idx_invoices_number
          ON invoices(invoice_number)
        `).run();

        return jsonResponse(
          {
            ok: true,
            message: "Databáza bola inicializovaná"
          },
          200,
          corsHeaders
        );
      }

      if (url.pathname === "/api/companies" && request.method === "GET") {
        const result = await env.FAKTURY_DB.prepare(`
          SELECT id, name, data, created_at, updated_at
          FROM companies
          ORDER BY updated_at DESC
        `).all();

        const companies = (result.results || []).map(row => {
          const parsed = safeParse(row.data, {});
          return {
            ...parsed,
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        });

        return jsonResponse({ ok: true, companies }, 200, corsHeaders);
      }

      if (url.pathname === "/api/companies" && request.method === "POST") {
        const body = await request.json();
        const now = new Date().toISOString();

        const company = {
          ...body,
          id: body.id || crypto.randomUUID(),
          updatedAt: now,
          createdAt: body.createdAt || now
        };

        if (!company.name || !String(company.name).trim()) {
          return jsonResponse(
            { ok: false, error: "Názov firmy je povinný." },
            400,
            corsHeaders
          );
        }

        await env.FAKTURY_DB.prepare(`
          INSERT OR REPLACE INTO companies (
            id, name, data, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `).bind(
          company.id,
          company.name,
          JSON.stringify(company),
          company.createdAt,
          company.updatedAt
        ).run();

        return jsonResponse({ ok: true, company }, 200, corsHeaders);
      }

      if (url.pathname.startsWith("/api/companies/") && request.method === "DELETE") {
        const companyId = url.pathname.split("/").pop();

        if (!companyId) {
          return jsonResponse(
            { ok: false, error: "Chýba ID firmy." },
            400,
            corsHeaders
          );
        }

        await env.FAKTURY_DB.prepare("DELETE FROM companies WHERE id = ?")
          .bind(companyId)
          .run();

        await env.FAKTURY_DB.prepare("DELETE FROM customers WHERE company_id = ?")
          .bind(companyId)
          .run();

        await env.FAKTURY_DB.prepare("DELETE FROM invoices WHERE company_id = ?")
          .bind(companyId)
          .run();

        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/customers" && request.method === "GET") {
        const companyId = url.searchParams.get("companyId");

        if (!companyId) {
          return jsonResponse(
            { ok: false, error: "Chýba companyId." },
            400,
            corsHeaders
          );
        }

        const result = await env.FAKTURY_DB.prepare(`
          SELECT id, name, data, created_at, updated_at
          FROM customers
          WHERE company_id = ?
          ORDER BY updated_at DESC
        `).bind(companyId).all();

        const customers = (result.results || []).map(row => {
          const parsed = safeParse(row.data, {});
          return {
            ...parsed,
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        });

        return jsonResponse({ ok: true, customers }, 200, corsHeaders);
      }

      if (url.pathname === "/api/customers" && request.method === "POST") {
        const body = await request.json();
        const now = new Date().toISOString();

        if (!body.companyId) {
          return jsonResponse(
            { ok: false, error: "companyId je povinné." },
            400,
            corsHeaders
          );
        }

        const customer = {
          ...body,
          id: body.id || crypto.randomUUID(),
          updatedAt: now,
          createdAt: body.createdAt || now
        };

        if (!customer.name || !String(customer.name).trim()) {
          return jsonResponse(
            { ok: false, error: "Názov klienta je povinný." },
            400,
            corsHeaders
          );
        }

        await env.FAKTURY_DB.prepare(`
          INSERT OR REPLACE INTO customers (
            id, company_id, name, data, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          customer.id,
          body.companyId,
          customer.name,
          JSON.stringify(customer),
          customer.createdAt,
          customer.updatedAt
        ).run();

        return jsonResponse({ ok: true, customer }, 200, corsHeaders);
      }

      if (url.pathname.startsWith("/api/customers/") && request.method === "DELETE") {
        const customerId = url.pathname.split("/").pop();

        if (!customerId) {
          return jsonResponse(
            { ok: false, error: "Chýba ID klienta." },
            400,
            corsHeaders
          );
        }

        await env.FAKTURY_DB.prepare("DELETE FROM customers WHERE id = ?")
          .bind(customerId)
          .run();

        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      if (url.pathname === "/api/invoices" && request.method === "GET") {
        const companyId = url.searchParams.get("companyId");
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();

        if (!companyId) {
          return jsonResponse(
            { ok: false, error: "Chýba companyId." },
            400,
            corsHeaders
          );
        }

        const result = await env.FAKTURY_DB.prepare(`
          SELECT id, invoice_number, customer_name, issued_date, due_date, total, due, data, created_at, updated_at
          FROM invoices
          WHERE company_id = ?
          ORDER BY updated_at DESC
        `).bind(companyId).all();

        let invoices = (result.results || []).map(row => {
          const parsed = safeParse(row.data, {});
          return {
            ...parsed,
            id: row.id,
            number: row.invoice_number,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          };
        });

        if (q) {
          invoices = invoices.filter(inv => {
            const haystack = [
              inv.number || "",
              inv.customer?.name || "",
              inv.issuedDate || "",
              inv.dueDate || "",
              inv.orderNumber || ""
            ].join(" ").toLowerCase();

            return haystack.includes(q);
          });
        }

        return jsonResponse({ ok: true, invoices }, 200, corsHeaders);
      }

      if (url.pathname === "/api/invoices" && request.method === "POST") {
        const body = await request.json();
        const now = new Date().toISOString();

        if (!body.companyId) {
          return jsonResponse(
            { ok: false, error: "companyId je povinné." },
            400,
            corsHeaders
          );
        }

        const invoice = {
          ...body,
          id: body.id || crypto.randomUUID(),
          updatedAt: now,
          createdAt: body.createdAt || now
        };

        await env.FAKTURY_DB.prepare(`
          INSERT OR REPLACE INTO invoices (
            id, company_id, invoice_number, customer_name, issued_date, due_date,
            total, due, data, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          invoice.id,
          invoice.companyId,
          invoice.number || "",
          invoice.customer?.name || "",
          invoice.issuedDate || "",
          invoice.dueDate || "",
          Number(invoice.totals?.total || 0),
          Number(invoice.totals?.due || 0),
          JSON.stringify(invoice),
          invoice.createdAt,
          invoice.updatedAt
        ).run();

        return jsonResponse({ ok: true, invoice }, 200, corsHeaders);
      }

      if (url.pathname.startsWith("/api/invoices/") && request.method === "DELETE") {
        const invoiceId = url.pathname.split("/").pop();

        if (!invoiceId) {
          return jsonResponse(
            { ok: false, error: "Chýba ID faktúry." },
            400,
            corsHeaders
          );
        }

        await env.FAKTURY_DB.prepare("DELETE FROM invoices WHERE id = ?")
          .bind(invoiceId)
          .run();

        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      return jsonResponse(
        { ok: false, error: "Route neexistuje." },
        404,
        corsHeaders
      );
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: "Server error",
          detail: String(error?.message || error)
        },
        500,
        corsHeaders
      );
    }
  }
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
          }
