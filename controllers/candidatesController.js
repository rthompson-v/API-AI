import pool from "../db.js";

export async function profileView(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT *
      FROM v_candidate_profile
    `);

    res.status(200).json({
      ok: true,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("Error en /candidates/profile-view:", err);
    res.status(500).json({
      ok: false,
      error: "Error consultando la vista v_candidate_profile",
    });
  }
}

export async function candidatesSearch(req, res) {
  try {
    const qRaw = String(req.body?.q ?? "").trim();
    const limit = Math.min(Number(req.body?.limit ?? 50), 200);
    const offset = Math.max(Number(req.body?.offset ?? 0), 0);

    const searchable = [
      "candidate_code",
      "full_name",
      "email",
      "phone",
      "status",
      "role",
      "location",
      "seniority",
      "availability_notes",
      "cost_text",
      "available_from",
      "available_to",
      "years_experience",
      "english_score",
      "suggested_customer_contractor_rate",
      "suggested_customer_employee_rate",
    ];

    if (!qRaw) {
      const [rows] = await pool.query(
        `
        SELECT *
        FROM v_candidate_profile
        ORDER BY candidate_id DESC
        LIMIT ? OFFSET ?
        `,
        [limit, offset]
      );
      return res.json({ ok: true, count: rows.length, data: rows });
    }

    const tokens = qRaw.split(/\s+/).filter(Boolean);

    const fieldFilters = [];
    const freeTokens = [];

    for (const t of tokens) {
      const m = t.match(/^([a-zA-Z_]+):(.+)$/);
      if (m) {
        const field = m[1];
        const value = m[2];
        const aliasMap = {
          name: "full_name",
          english: "english_score",
          exp: "years_experience",
        };
        const col = aliasMap[field] || field;
        if (searchable.includes(col)) {
          fieldFilters.push({ col, value });
          continue;
        }
      }
      freeTokens.push(t);
    }

    const whereParts = [];
    const params = [];

    for (const ff of fieldFilters) {
      whereParts.push(`(${ff.col} LIKE ?)`);
      params.push(`%${ff.value}%`);
    }

    for (const token of freeTokens) {
      const like = `%${token}%`;
      const orParts = searchable.map((col) => `(${col} LIKE ?)`);
      whereParts.push(`(${orParts.join(" OR ")})`);
      params.push(...searchable.map(() => like));
    }

    if (whereParts.length === 0) {
      whereParts.push(`(full_name LIKE ?)`);
      params.push(`%${qRaw}%`);
    }

    const numericMatch = qRaw.match(/-?\d+(\.\d+)?/);
    const n = numericMatch ? Number(numericMatch[0]) : null;

    let orderSql = "";
    if (n !== null && Number.isFinite(n)) {
      orderSql = `
        ORDER BY
          ABS(IFNULL(english_score, 999999) - ?) ASC,
          IFNULL(english_score, -1) DESC,
          full_name ASC
      `;
      params.push(n);
    } else {
      orderSql = `
        ORDER BY
          (full_name LIKE CONCAT(?, '%')) DESC,
          full_name ASC
      `;
      params.push(freeTokens[0] ?? qRaw);
    }

    params.push(limit, offset);

    const sql = `
      SELECT *
      FROM v_candidate_profile
      WHERE ${whereParts.join(" AND ")}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(sql, params);

    return res.json({
      ok: true,
      q: qRaw,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("Error en POST /candidates/search:", err);
    return res.status(500).json({ ok: false, error: "Error buscando candidatos" });
  }
}
