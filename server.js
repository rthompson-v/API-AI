import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

//VECTOR STORE ID
const VECTOR_STORE_ID = "vs_6916291be5348191a8c802a2f6393713";

app.post("/chat", async (req, res) => {
  try {
    console.log("Body recibido en /chat:", req.body);

    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "El body debe tener un campo 'messages' que sea un array con al menos un mensaje.",
      });
    }

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: messages,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ],
    });

    // ---- extracción segura del texto ----
    let text = "";

    if (response.output_text) {
      // atajo recomendado
      text = response.output_text;
    } else {
      const firstOutput = response.output?.[0];
      const firstContent = firstOutput?.content?.[0];

      if (firstContent?.text?.value) {
        text = firstContent.text.value;
      } else {
        text = "No pude extraer texto de la respuesta del modelo.";
        console.log(
          "Respuesta de la API sin texto claro:",
          JSON.stringify(response, null, 2)
        );
      }
    }
    // --------------------------------------

    res.json({ reply: text });
  } catch (err) {
    console.error("Error en /chat:", err);
    res.status(500).json({ error: "Error en el servidor de IA" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor IA listo en http://localhost:${PORT}`);
});
