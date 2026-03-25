import { pool1 } from "../db.js";

export async function profileView(req, res) {
  try {
    const result = await pool1.query(`SELECT * FROM v_candidate_profile`); // Sin [rows]
    res.status(200).json({
      ok: true,
      count: result.rows.length,
      data: result.rows, // Los datos están en result.rows
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
    const tier = resolveTier(req.user);
    const qRaw = String(req.body?.q ?? "").trim();
    const limit = Math.min(Number(req.body?.limit ?? 50), 200);

    //Campos de texto buscables con LIKE
    // Nota: estos campos deben prefijarse con "v." en WHERE ya que hacemos JOIN con candidate
    const textSearchable = [
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
      "hiring_preference",
      "technologies",
      "skills",
    ];

    //Campos numéricos — usan = o BETWEEN, nunca LIKE
    const numericFields = [
      "english_score",
      "years_experience",
      "suggested_customer_contractor_rate",
      "suggested_customer_employee_rate",
    ];

    //Campos de fecha
    const dateFields = ["available_from", "available_to"];

    const allSearchable = [...textSearchable, ...numericFields, ...dateFields];

    // ─── Sin query: trae últimos ────────────────────────────────────────────
    if (!qRaw) {
      const result = await pool1.query(
        `SELECT
           v.*,
           c.cv_url AS cv
         FROM v_candidate_profile v
         LEFT JOIN "candidate" c ON c.candidate_id = v.candidate_id
         ORDER BY v.candidate_id DESC LIMIT $1`,
        [limit]
      );
      return res.json({ ok: true, tier, q: "", count: result.rows.length, data: applyTier(result.rows, tier) });
    }

    // ─── Tokenización ───────────────────────────────────────────────────────
    const tokens = qRaw.split(/\s+/).filter(Boolean);
    const fieldFilters = [];
    const freeTokens = [];

    const aliasMap = {
      name:     "full_name",
      english:  "english_score",
      exp:      "years_experience",
      rate:     "suggested_customer_contractor_rate",
      location: "location",
      role:     "role",
      tech:     "technologies",
      pref:     "hiring_preference",
    };

    for (const t of tokens) {
      // Soporte field:value  Y  field:min-max (rangos)
      const m = t.match(/^([a-zA-Z_]+):(.+)$/);
      if (m) {
        const col = aliasMap[m[1]] || m[1];
        if (allSearchable.includes(col)) {
          // Rango numérico  ej: exp:3-5
          const range = m[2].match(/^(\d+\.?\d*)-(\d+\.?\d*)$/);
          if (range && numericFields.includes(col)) {
            fieldFilters.push({ col, type: "range", min: Number(range[1]), max: Number(range[2]) });
          } else if (numericFields.includes(col) && !isNaN(Number(m[2]))) {
            fieldFilters.push({ col, type: "numeric", value: Number(m[2]) });
          } else {
            fieldFilters.push({ col, type: "like", value: m[2] });
          }
          continue;
        }
      }
      freeTokens.push(t);
    }

    // ─── Construcción WHERE ─────────────────────────────────────────────────
    const whereParts = [];
    const params = [];
    let pIdx = 1; // IMPORTANTE: Contador para $1, $2, etc.

    // Filtros field:value
    for (const ff of fieldFilters) {
      if (ff.type === "range") {
        whereParts.push(`("${ff.col}" BETWEEN $${pIdx++} AND $${pIdx++})`);
        params.push(ff.min, ff.max);
      } else if (ff.type === "numeric") {
        whereParts.push(`("${ff.col}" = $${pIdx++})`);
        params.push(ff.value);
      } else {
        // Columnas de v_candidate_profile se prefijan con v. para evitar ambigüedad
        const colRef = `v."${ff.col}"`;
        whereParts.push(`(${colRef} ILIKE $${pIdx++})`);
        params.push(`%${ff.value}%`);
      }
    }

    // Free tokens — texto busca en textSearchable, números buscan en numericFields
    for (const token of freeTokens) {
      const isNum = !isNaN(Number(token)) && token !== "";
      const orParts = [];

      if (isNum) {
        for (const col of numericFields) {
          orParts.push(`("${col}" = $${pIdx++})`);
          params.push(Number(token));
        }
      }

      // Siempre busca en campos de texto también
      for (const col of textSearchable) {
        const colRef = `v."${col}"`;
        orParts.push(`(${colRef} ILIKE $${pIdx++})`);
        params.push(`%${token}%`);
      }

      if (orParts.length) {
        whereParts.push(`(${orParts.join(" OR ")})`);
      }
    }

    if (whereParts.length === 0) {
      whereParts.push(`(v."full_name" ILIKE $${pIdx++})`);
      params.push(`%${qRaw}%`);
    }

    // ─── Ordenación ─────────────────────────────────────────────────────────
    const firstNum = freeTokens.find(t => !isNaN(Number(t)) && t !== "");
    let orderSql = "";

    if (firstNum !== undefined) {
      // Postgres usa COALESCE en lugar de IFNULL
      orderSql = `
        ORDER BY
          ABS(COALESCE(v."english_score", 999999) - $${pIdx++}) ASC,
          ABS(COALESCE(v."years_experience", 999999) - $${pIdx++}) ASC,
          v."full_name" ASC
      `;
      params.push(Number(firstNum), Number(firstNum));
    } else {
      const firstToken = freeTokens[0] ?? qRaw;
      orderSql = `
        ORDER BY
          (v."full_name" ILIKE $${pIdx++} || '%') DESC,
          v."full_name" ASC
      `;
      params.push(firstToken);
    }

    params.push(limit);
    const sql = `
      SELECT
        v.*,
        c.cv_url AS cv
      FROM v_candidate_profile v
      LEFT JOIN "candidate" c ON c.candidate_id = v.candidate_id
      WHERE ${whereParts.join(" AND ")}
      ${orderSql}
      LIMIT $${pIdx++}
    `;

    const result = await pool1.query(sql, params);
    return res.json({ ok: true, tier, q: qRaw, count: result.rows.length, data: applyTier(result.rows, tier) });

  } catch (err) {
    console.error("Error en POST /candidates/search:", err);
    return res.status(500).json({ ok: false, error: "Error buscando candidatos" });
  }
}

// ─── Helper: aplica fieldSpecs del tier Y garantiza campos nuevos ──────────
function applyTier(rows, tier) {
  const keysToUse = fieldSpecs[tier] || fieldSpecs.normal;

  
  const alwaysInclude = [
    "candidate_id",
    "candidate_code",
    "hiring_preference",
    "hiring_preference_id",
    "technologies",
    "skills",
    "role",
    "location",
  ];

  return rows.map(r => {
    const out = {};

    // Siempre incluir candidate_id
    if (Object.prototype.hasOwnProperty.call(r, "candidate_id")) {
      out.candidate_id = r.candidate_id;
    }

    // Campos del tier
    for (const k of keysToUse) {
      const v = resolveField(r, k);
      if (v !== null && v !== undefined) out[k] = v;
    }

    
    for (const k of alwaysInclude) {
      if (!(k in out) && Object.prototype.hasOwnProperty.call(r, k)) {
        const v = r[k];
        if (v !== null && v !== undefined) out[k] = v;
      }
    }

    return out;
  });
}

function resolveTier(reqUser) {
  const roleName = String(reqUser?.RoleName ?? reqUser?.role ?? reqUser?.Role ?? "").toLowerCase();
  const roleId   = Number(reqUser?.Role_CLP ?? reqUser?.role_id ?? reqUser?.roleId ?? 0);

  // Mapeo por ID — ajusta si tus IDs son diferentes
  const byId = {
    1: "usuario",
    2: "gerente",
    3: "administrador",
    4: "administrador",
  };

  if (Number.isFinite(roleId) && roleId > 0 && byId[roleId]) return byId[roleId];

  // Fallback por nombre de rol
  if (roleName.includes("admin"))    return "administrador";
  if (roleName.includes("gerente"))  return "gerente";
  if (roleName.includes("manager"))  return "gerente";
  if (roleName.includes("recruiter"))return "usuario";
  if (roleName.includes("reclutador")) return "usuario";
  if (roleName.includes("usuario"))  return "usuario";
  if (roleName.includes("user"))     return "usuario";

  // Si hay cualquier usuario autenticado, darle acceso de usuario base
  // 'normal' queda solo para tokens inválidos o sin rol
  if (reqUser) return "usuario";

  return "normal";
}

const fieldSpecs = {
  normal: [
    "candidate_code",
    "full_name",
    "email",
    "phone",
    "years_experience",
    "skillset",
    "last_update",
    "location",
    "english_score",
    "cv",
  ],
  usuario: [
    "candidate_code",
    "full_name",
    "email",
    "phone",
    "years_experience",
    "skillset",
    "last_update",
    "location",
    "english_score",
    "linkedin",
    "cv",
  ],
  gerente: [
    "candidate_code",
    "full_name",
    "email",
    "phone",
    "years_experience",
    "skillset",
    "last_update",
    "location",
    "english_score",
    "linkedin",
    "cv",
    "tarifa",
    "costo_expectativa",
  ],
  administrador: [
    "candidate_code",
    "full_name",
    "email",
    "phone",
    "years_experience",
    "skillset",
    "last_update",
    "location",
    "english_score",
    "linkedin",
    "cv",
    "tarifa",
    "costo_expectativa",
  ],
};

const aliases = {
  full_name: ["full_name", "name", "candidate_name"],
  years_experience: ["years_experience", "experiencia", "experience", "yrs_experience"],
  skillset: ["skillset", "skills", "skill_set"],
  last_update: ["last_update", "updated_at", "lastupdate", "historial", "history"],
  location: ["location", "place", "city"],
  english_score: ["english_score", "english_level", "english"],
  linkedin: ["linkedin", "linkedin_url"],
  phone: ["phone", "telefono", "phone_number"],
  email: ["email", "email_address"],
  cv: ["cv", "cv_url", "resume", "resume_url"],
  tarifa: ["tarifa", "rate", "suggested_customer_contractor_rate", "suggested_rate"],
  costo_expectativa: ["costo_expectativa", "cost_expectation", "expected_cost", "cost_text"],
};

function resolveField(row, key) {
  const names = aliases[key] || [key];
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(row, n) && row[n] !== undefined) return row[n];
  }
  return null;
}



export async function profileViewByRole(req, res) {
  try {
    const tier = resolveTier(req.user);
    const limit = Math.min(Number(req.body?.limit ?? req.query?.limit ?? 20), 100);
    const page = Math.max(Number(req.body?.page ?? req.query?.page ?? 1), 1);
    const offset = (page - 1) * limit;

    // En Postgres el conteo se extrae de .rows[0]
    const countRes = await pool1.query(`SELECT COUNT(*) AS total FROM v_candidate_profile`);
    const total = parseInt(countRes.rows[0].total);

    const result = await pool1.query(
      `SELECT
         v.*,
         c.cv_url AS cv
       FROM v_candidate_profile v
       LEFT JOIN "candidate" c ON c.candidate_id = v.candidate_id
       ORDER BY v.candidate_id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const keysToUse = fieldSpecs[tier] || fieldSpecs.normal;
    const data = result.rows.map((r) => {
      const out = {};
      if (Object.prototype.hasOwnProperty.call(r, "candidate_id")) out.candidate_id = r.candidate_id;
      for (const k of keysToUse) {
        const v = resolveField(r, k);
        if (v !== null && v !== undefined) out[k] = v;
      }
      return out;
    });

    return res.status(200).json({
      ok: true, tier, page, limit, total,
      totalPages: Math.ceil(total / limit),
      count: data.length, data,
    });
  } catch (err) {
    console.error("Error en /candidates/profile-view-by-role:", err);
    return res.status(500).json({ ok: false, error: "Error consultando vista" });
  }
}
//Insercion------------------------------------------------------------------------------------------------------------------------------
// Función para agregar usuario Reclutador/Gerente
export async function addRecruiterManager(req, res) {
  // En pg, usamos .connect() para obtener un cliente del pool para la transacción
  const client = await pool1.connect(); 

  try {
    const {
      Name, Experiencia, Skillset, Location, EnglishLevel,
      Linkedin, Telefono, Email, CV, Expectativas,
      Esquema, Rol, Tecnologia, Modulos, Visa, HiringPreference
    } = req.body;

    if (!Name || !Rol) {
      return res.status(400).json({ ok: false, error: "Faltan campos obligatorios: Name, Rol" });
    }

    const toArray = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

    // Helper: busca por nombre/id, devuelve null si no existe
    const resolveId = async ({ table, idCol, nameCol, value }) => {
      if (!value) return null;
      if (typeof value === "number" || /^\d+$/.test(String(value).trim())) return Number(value);
      const result = await client.query(
        `SELECT "${idCol}" AS id FROM "${table}" WHERE "${nameCol}" = $1 LIMIT 1`,
        [String(value).trim()]
      );
      return result.rows.length ? result.rows[0].id : null;
    };

    // Helper: obtiene o crea una tecnología por nombre (case-insensitive), devuelve su ID
    const resolveOrCreateTech = async (techName) => {
      if (!techName) return null;
      const name = String(techName).trim();
      if (!name) return null;
      // Buscar (case-insensitive)
      const found = await client.query(
        `SELECT technology_id AS id FROM "catalog_technology"
         WHERE LOWER(ct_name_tech) = LOWER($1) LIMIT 1`,
        [name]
      );
      if (found.rows.length) return found.rows[0].id;
      // Si no existe, crearla — doble check para evitar race conditions
      try {
        const created = await client.query(
          `INSERT INTO "catalog_technology" (ct_name_tech) VALUES ($1) RETURNING technology_id AS id`,
          [name]
        );
        return created.rows[0].id;
      } catch (e) {
        // Si falla por duplicate key, buscarla de nuevo
        const retry = await client.query(
          `SELECT technology_id AS id FROM "catalog_technology"
           WHERE LOWER(ct_name_tech) = LOWER($1) LIMIT 1`,
          [name]
        );
        return retry.rows.length ? retry.rows[0].id : null;
      }
    };

    // Iniciamos transacción en Postgres
    await client.query('BEGIN');

    // 1) Resolver IDs (Location, Role, etc.)
    const locationId = await resolveId({ table: "catalog_location", idCol: "location_id", nameCol: "name", value: Location });
    const roleId = await resolveId({ table: "catalog_role", idCol: "role_id", nameCol: "name", value: Rol });

    if (!roleId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: "Rol inválido" });
    }

    const candidateCode = `RM-${Date.now()}`;

    // Resolver hiring_preference_id
    const hiringPrefId = HiringPreference
      ? await resolveId({ table: "catalog_hiring_preference", idCol: "hiring_preference_id", nameCol: "name", value: HiringPreference })
      : null;

    // 2) INSERT candidate con RETURNING
    const candRes = await client.query(
      `INSERT INTO "candidate" (
        "candidate_code", "full_name", "phone", "email", "cv_url",
        "location_id", "role_id", "english_score", "years_experience",
        "hiring_preference_id"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING "candidate_id"`,
      [candidateCode, Name, Telefono || null, Email || null, CV || null,
       locationId, roleId, EnglishLevel ?? null, Experiencia ?? null,
       hiringPrefId]
    );

    const candidateId = candRes.rows[0].candidate_id;

    // 3) INSERT notes (Postgres no soporta "VALUES ?" para arrays de arrays fácilmente)
    if (Skillset) {
      await client.query(
        `INSERT INTO "candidate_note" ("candidate_id", "note_type", "note_text") VALUES ($1, $2, $3)`,
        [candidateId, 'SKILLSET', typeof Skillset === "string" ? Skillset : JSON.stringify(Skillset)]
      );
    }
    if (Visa) {
      await client.query(
        `INSERT INTO "candidate_note" ("candidate_id", "note_type", "note_text") VALUES ($1, $2, $3)`,
        [candidateId, 'VISA', typeof Visa === "string" ? Visa : JSON.stringify(Visa)]
      );
    }

    // 4) INSERT stack — crea la tecnología si no existe en el catálogo
    const techValues = toArray(Tecnologia);
    console.log("[addRecruiterManager] Tecnologias a insertar:", techValues);
    for (const t of techValues) {
      if (!t || String(t).trim() === "") continue;
      const techId = await resolveOrCreateTech(t);
      console.log("[addRecruiterManager] tech:", t, "-> id:", techId);
      if (techId) {
        await client.query(
          `INSERT INTO "candidate_stack" ("candidate_id", "technology_id")
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [candidateId, techId]
        );
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      candidate_id: candidateId,
      message: "Candidato agregado correctamente en Postgres"
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error en addRecruiterManager:", err);
    return res.status(500).json({ ok: false, error: "Error en servidor" });
  } finally {
    client.release(); // Siempre liberar el cliente al pool
  }
}

// Ejemplo para getLocations (Aplica lo mismo para getRoles, getTechnologies, etc.)
export async function getLocations(req, res) {
  try {
    const result = await pool1.query(`SELECT location_id AS id, name FROM catalog_location ORDER BY name`);
    res.json({ ok: true, data: result.rows }); // Cambiado de rows a result.rows
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo locations" });
  }
}

export async function getRoles(req, res) {
  try {
    const result = await pool1.query(
      `SELECT role_id AS id, name
       FROM catalog_role
       ORDER BY name`
    );
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo roles" });
  }
}

export async function getTechnologies(req, res) {
  try {
    const result = await pool1.query(
      `SELECT technology_id AS id, ct_name_tech AS name
       FROM catalog_technology
       ORDER BY ct_name_tech`
    );
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo tecnologías" });
  }
}

export async function getModulesByTechnology(req, res) {
  try {
    const { technology_id } = req.params;
    const result = await pool1.query(
      `SELECT module_id AS id, module_catalogname AS name
       FROM catalog_module
       WHERE technology_id = $1
       ORDER BY module_catalogname`,
      [technology_id]
    );
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo módulos" });
  }
}

export async function getSubmodulesByModule(req, res) {
  try {
    const { module_id } = req.params;
    const result = await pool1.query(
      `SELECT submodule_id AS id, subm_catalog_name AS name
       FROM catalog_submodule
       WHERE module_id = $1
       ORDER BY subm_catalog_name`,
      [module_id]
    );
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo submódulos" });
  }
}

export async function getHiringPreferences(req, res) {
  try {
    const result = await pool1.query(
      `SELECT hiring_preference_id AS id, name
       FROM catalog_hiring_preference
       ORDER BY hiring_preference_id`
    );
    res.json({ ok: true, data: result. rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo hiring preferences" });
  }
}

export async function updateCandidateByCode(req, res) {
  // Obtenemos un cliente del pool para manejar la transacción
  const client = await pool1.connect();

  try {
    const { candidate_code } = req.params;
    const {
      Name, Telefono, Email, CV, Location, Rol,
      EnglishLevel, Experiencia, Expectativas,
      Skillset, Visa, Tecnologia, Modulos,
      replaceStack, HiringPreference
    } = req.body;

    if (!candidate_code) {
      return res.status(400).json({ ok: false, error: "Falta candidate_code" });
    }

    const toArray = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

    // Helper: busca por nombre/id
    const resolveId = async ({ table, idCol, nameCol, value }) => {
      if (!value) return null;
      if (typeof value === "number" || /^\d+$/.test(String(value).trim())) return Number(value);
      const result = await client.query(
        `SELECT "${idCol}" AS id FROM "${table}" WHERE "${nameCol}" = $1 LIMIT 1`,
        [String(value).trim()]
      );
      return result.rows.length ? result.rows[0].id : null;
    };

    // Helper: obtiene o crea una tecnología por nombre (case-insensitive)
    const resolveOrCreateTech = async (techName) => {
      if (!techName) return null;
      const name = String(techName).trim();
      if (!name) return null;
      const found = await client.query(
        `SELECT technology_id AS id FROM "catalog_technology"
         WHERE LOWER(ct_name_tech) = LOWER($1) LIMIT 1`,
        [name]
      );
      if (found.rows.length) return found.rows[0].id;
      try {
        const created = await client.query(
          `INSERT INTO "catalog_technology" (ct_name_tech) VALUES ($1) RETURNING technology_id AS id`,
          [name]
        );
        return created.rows[0].id;
      } catch (e) {
        const retry = await client.query(
          `SELECT technology_id AS id FROM "catalog_technology"
           WHERE LOWER(ct_name_tech) = LOWER($1) LIMIT 1`,
          [name]
        );
        return retry.rows.length ? retry.rows[0].id : null;
      }
    };

    await client.query('BEGIN');

    // 1) Buscar ID del candidato
    const candResult = await client.query(
      `SELECT "candidate_id" FROM "candidate" WHERE "candidate_code" = $1 LIMIT 1`,
      [candidate_code]
    );

    if (candResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: "Candidato no encontrado" });
    }

    const candidateId = candResult.rows[0].candidate_id;

    // 2) UPDATE dinámico de la tabla candidate
    const set = [];
    const vals = [];
    let pIdx = 1; // Contador de placeholders ($1, $2...)

    if (Name !== undefined) { set.push(`"full_name" = $${pIdx++}`); vals.push(Name); }
    if (Telefono !== undefined) { set.push(`"phone" = $${pIdx++}`); vals.push(Telefono || null); }
    if (Email !== undefined) { set.push(`"email" = $${pIdx++}`); vals.push(Email || null); }
    if (CV !== undefined) { set.push(`"cv_url" = $${pIdx++}`); vals.push(CV || null); }
    if (EnglishLevel !== undefined) { set.push(`"english_score" = $${pIdx++}`); vals.push(EnglishLevel ?? null); }
    if (Experiencia !== undefined) { set.push(`"years_experience" = $${pIdx++}`); vals.push(Experiencia ?? null); }

    if (Location !== undefined) {
      const locId = await resolveId({ table: "catalog_location", idCol: "location_id", nameCol: "name", value: Location });
      set.push(`"location_id" = $${pIdx++}`);
      vals.push(locId);
    }

    if (Rol !== undefined) {
      const rId = await resolveId({ table: "catalog_role", idCol: "role_id", nameCol: "name", value: Rol });
      if (rId) { set.push(`"role_id" = $${pIdx++}`); vals.push(rId); }
    }

    if (HiringPreference !== undefined) {
      const hpId = await resolveId({ table: "catalog_hiring_preference", idCol: "hiring_preference_id", nameCol: "name", value: HiringPreference });
      set.push(`"hiring_preference_id" = $${pIdx++}`);
      vals.push(hpId);
    }

    if (set.length > 0) {
      vals.push(candidateId);
      await client.query(
        `UPDATE "candidate" SET ${set.join(", ")} WHERE "candidate_id" = $${pIdx}`,
        vals
      );
    }

    // 3) Históricos (Compensation y Notes)
    if (Expectativas !== undefined) {
      await client.query(
        `INSERT INTO "candidate_compensation" ("candidate_id", "cost_text") VALUES ($1, $2)`,
        [candidateId, Expectativas || null]
      );
    }

    if (Skillset) {
      await client.query(
        `INSERT INTO "candidate_note" ("candidate_id", "note_type", "note_text") VALUES ($1, $2, $3)`,
        [candidateId, 'SKILLSET', typeof Skillset === "string" ? Skillset : JSON.stringify(Skillset)]
      );
    }

    // 4) Stack (Tecnologías)
    if (replaceStack) {
      await client.query(`DELETE FROM "candidate_stack" WHERE "candidate_id" = $1`, [candidateId]);
    }

    if (Tecnologia !== undefined) {
      const techValues = toArray(Tecnologia);
      console.log("[updateCandidate] Tecnologias a insertar:", techValues);
      for (const t of techValues) {
        if (!t || String(t).trim() === "") continue;
        const tId = await resolveOrCreateTech(t);
        console.log("[updateCandidate] tech:", t, "-> id:", tId);
        if (tId) {
          await client.query(
            `INSERT INTO "candidate_stack" ("candidate_id", "technology_id")
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [candidateId, tId]
          );
        }
      }
    }

    await client.query('COMMIT');
    return res.json({ ok: true, message: "Candidato actualizado en Postgres" });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error en updateCandidateByCode:", err);
    return res.status(500).json({ ok: false, error: "Error al actualizar" });
  } finally {
    client.release();
  }
}

export async function listCandidates(req, res) {
  try {
    const q = (req.query.q || "").trim();
    // En Postgres usamos ILIKE y $1. La concatenación puede ser con CONCAT o ||
    const sql = `
      SELECT c.candidate_code, c.full_name, c.email, c.phone, r.name AS role_name, l.name AS location_name, c.updated_at
      FROM candidate c
      LEFT JOIN catalog_role r ON r.role_id = c.role_id
      LEFT JOIN catalog_location l ON l.location_id = c.location_id
      WHERE ($1 = '' OR c.candidate_code ILIKE '%' || $1 || '%'
                   OR c.full_name ILIKE '%' || $1 || '%'
                   OR c.email ILIKE '%' || $1 || '%')
      ORDER BY c.updated_at DESC LIMIT 100`;

    const result = await pool1.query(sql, [q]);
    res.json({ ok: true, data: result.rows });
  } catch (e) {
    console.error("listCandidates:", e);
    res.status(500).json({ ok: false, error: "Error listando candidatos" });
  }
}


export async function getCandidateByCode(req, res) {
  // En Postgres usamos .connect() para obtener un cliente del pool
  const client = await pool1.connect(); 
  
  try {
    const { candidate_code } = req.params;

    // 1) Buscar datos base del candidato + nombres de catálogos (location, role, hiring_preference)
    const candRes = await client.query(
      `SELECT
         c.*,
         cl.name  AS location,
         cr.name  AS role,
         chp.name AS hiring_preference
       FROM "candidate" c
       LEFT JOIN "catalog_location"           cl  ON cl.location_id           = c.location_id
       LEFT JOIN "catalog_role"               cr  ON cr.role_id                = c.role_id
       LEFT JOIN "catalog_hiring_preference"  chp ON chp.hiring_preference_id = c.hiring_preference_id
       WHERE c.candidate_code = $1
       LIMIT 1`,
      [candidate_code]
    );

    if (candRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Candidato no encontrado" });
    }

    const c = candRes.rows[0];

    // 2) Consultar el Stack tecnológico
    const stackRes = await client.query(
      `SELECT
         cs.technology_id,
         t.ct_name_tech AS technology_name,
         cs.module_id,
         m.module_catalogname AS module_name,
         cs.submodule_id,
         s.subm_catalog_name AS submodule_name
       FROM "candidate_stack" cs
       LEFT JOIN "catalog_technology" t ON t.technology_id = cs.technology_id
       LEFT JOIN "catalog_module" m ON m.module_id = cs.module_id
       LEFT JOIN "catalog_submodule" s ON s.submodule_id = cs.submodule_id
       WHERE cs.candidate_id = $1
       ORDER BY t.ct_name_tech, m.module_catalogname, s.subm_catalog_name`,
      [c.candidate_id]
    );

    // 3) Consultar la última compensación registrada
    const compRes = await client.query(
      `SELECT cost_text, scheme, recorded_at
       FROM "candidate_compensation"
       WHERE candidate_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [c.candidate_id]
    );

    // 4) Consultar última nota de tipo VISA
    const visaRes = await client.query(
      `SELECT note_text, recorded_at
       FROM "candidate_note"
       WHERE candidate_id = $1 AND note_type = 'VISA'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [c.candidate_id]
    );

    // 5) Consultar última nota de tipo SKILLSET
    const skillRes = await client.query(
      `SELECT note_text, recorded_at
       FROM "candidate_note"
       WHERE candidate_id = $1 AND note_type = 'SKILLSET'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [c.candidate_id]
    );

    // Respuesta final consolidada
    return res.json({
      ok: true,
      data: {
        candidate: {
          ...c,
          // Exponemos skillset directamente para facilitar el formulario de edición
          skillset: skillRes.rows[0]?.note_text ?? null,
          // cv_url normalizado también como cv para el frontend
          cv: c.cv_url ?? null,
        },
        stack: stackRes.rows,
        lastCompensation: compRes.rows[0] || null,
        lastVisa: visaRes.rows[0] || null,
        lastSkillset: skillRes.rows[0] || null
      }
    });

  } catch (e) {
    console.error("Error en getCandidateByCode:", e);
    return res.status(500).json({ ok: false, error: "Error obteniendo detalles del candidato" });
  } finally {
    // Es CRÍTICO liberar el cliente para no agotar las conexiones de Supabase
    client.release();
  }
}