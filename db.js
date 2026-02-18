import mysql from "mysql2/promise";

// Primer pool de conexión (BD principal)
const pool1 = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Segundo pool de conexión (BD de usuarios)
const pool2 = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME2,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test de conexión para ambas bases de datos
(async function testConn() {
  try {
    const conn1 = await pool1.getConnection();
    console.log("Conectado a MySQL (BD principal)");
    conn1.release();
  } catch (err) {
    console.error("Error conectando a MySQL (BD principal):", err);
  }
  try {
    const conn2 = await pool2.getConnection();
    console.log("Conectado a MySQL (BD usuarios)");
    conn2.release();
  } catch (err) {
    console.error("Error conectando a MySQL (BD usuarios):", err);
  }
})();

export { pool1, pool2 };
