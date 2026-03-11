import { redis } from './redis'; // Importa la conexión a Redis.
import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

async function processJobs() {
    console.log("Worker iniciado, esperando trabajos...");
    if (!redis) {
        console.log("Redis no configurado (REDIS_URL ausente). Worker no iniciado.");
        return;
    }
    while (true) {
        try {
            // Espera un trabajo de la cola 'evaluation-jobs'
            const result = redis ? await redis.blpop('evaluation-jobs', 0) : null;

            // ==================================================================
            // INICIO DE LA CORRECCIÓN
            // Se verifica si el resultado no es null antes de desestructurarlo.
            // ==================================================================
            if (!result) {
                // Si no hay resultado, simplemente continúa el bucle y espera el siguiente.
                continue;
            }
            const [listName, jobId] = result;
            // ==================================================================
            // FIN DE LA CORRECCIÓN
            // ==================================================================
            
            // Carga los detalles del trabajo desde Redis
            const jobData = redis ? await redis.get(jobId) : null;
            if (!jobData) {
                console.error(`Error: Datos del trabajo ${jobId} no encontrados.`);
                continue;
            }
            const job = JSON.parse(jobData);
            console.log(`Procesando trabajo: ${jobId}`);

            // === Lógica de la IA (DEBES PERSONALIZAR ESTO) ===
            const { payload } = job;
            const { files, rubrica, pauta, flexibilidad, ...metadata } = payload;
            
            const prompt = `Evalúa el siguiente trabajo con la siguiente rúbrica:\n\nRubrica: ${rubrica}\n\nTrabajo del estudiante: ${files[0]}\n\nRespuesta correcta (opcional): ${pauta}\n\nNivel de flexibilidad: ${flexibilidad}`;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: "Eres un asistente de evaluación para profesores, tu misión es evaluar de manera precisa y constructiva el trabajo de un estudiante. Siempre incluye en tu respuesta un informe completo y conciso. Asegúrate de incluir el puntaje y la nota. En tu respuesta JSON, utiliza los campos 'informe_original', 'puntaje' y 'nota'." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" }
            });

            if (!completion.choices[0].message.content) {
                throw new Error("La respuesta de la IA vino vacía.");
            }
            const aiResult = JSON.parse(completion.choices[0].message.content);

            // === Actualiza el estado del trabajo en Redis ===
            if (redis) {
                await redis.set(`job:${jobId}:result`, JSON.stringify(aiResult));
                await redis.set(`job:${jobId}:status`, 'completed');
            }

            console.log(`Evaluación completada para Job ID: ${jobId}`);
            
        } catch (error) {
            console.error("Error en el worker:", error);
            // Si algo falla, podrías querer marcar el trabajo como fallido.
            // Por ejemplo, si tienes el 'jobId' disponible aquí.
            // await redis.set(`job:${jobId}:status`, 'failed');
        }
    }
}

// Inicia el worker
processJobs();

