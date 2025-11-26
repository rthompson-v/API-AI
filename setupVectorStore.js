import OpenAI from "openai";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Para que funcione path.join en ESM (Node con "type": "module")
import { fileURLToPath } from "url";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Necesario en ESM para tener __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    // 1. Crear el vector store
    const vectorStore = await client.vectorStores.create({
      name: "Base de conocimiento local",
    });

    console.log("Vector Store ID:", vectorStore.id);

    // 2. Leer archivos de la carpeta docs (NO se importa la carpeta)
    const docsDir = path.join(__dirname, "docs"); // C:\API-AI\docs
    const fileNames = fs.readdirSync(docsDir);

    // Filtra solo archivos "normales" por si acaso
    const fileStreams = fileNames
      .map((file) => path.join(docsDir, file))
      .filter((filePath) => fs.statSync(filePath).isFile())
      .map((filePath) => fs.createReadStream(filePath));

    if (fileStreams.length === 0) {
      console.log("No se encontraron archivos en la carpeta docs");
      return;
    }

    // 3. Subir archivos al vector store
    const fileBatch = await client.vectorStores.fileBatches.uploadAndPoll(
      vectorStore.id,
      { files: fileStreams }
    );

    console.log("Estado del batch:", fileBatch.status);
    console.log("Archivos procesados:", fileBatch.file_counts);
  } catch (err) {
    console.error("Error creando vector store:", err);
  }
}

main();
