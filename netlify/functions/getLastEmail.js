require("dotenv").config();
const { google } = require("googleapis");
const Imap = require("node-imap");
const { simpleParser } = require("mailparser");

// Función para generar un retraso aleatorio sin necesidad de `sleep()`
function delay() {
  const delayTime = Math.floor(Math.random() * (9000 - 3000 + 1)) + 3000; // Aleatorio entre 3000ms (3s) y 9000ms (9s)
  return new Promise(resolve => setTimeout(resolve, delayTime)); // Devuelve una promesa que se resuelve después del delay
}

exports.handler = async (event) => {
  try {
    const { email } = JSON.parse(event.body);

    // Configuración de autenticación OAuth2 para IMAP
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      "https://pruebajajaja.netlify.app/api/auth/callback"
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });

    // Obtener el access_token usando el refresh_token
    const { credentials } = await oauth2Client.refreshAccessToken();
    const accessToken = credentials.access_token;

    // Configuración IMAP con acceso OAuth2
    const imapConfig = {
      user: email,
      xoauth2: accessToken, // Usamos el access_token como método de autenticación
      host: "imap.gmail.com",
      port: 993,
      tls: true,
    };

    const imap = new Imap(imapConfig);

    // Conectamos al servidor IMAP
    imap.once("ready", () => {
      // Abrir la bandeja de entrada
      imap.openBox("INBOX", false, async (err, box) => {
        if (err) throw err;

        // Buscar los correos no leídos
        imap.search(["UNSEEN"], async (err, results) => {
          if (err) throw err;
          if (!results || results.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ message: "No hay mensajes recientes" }) };
          }

          // Buscar los primeros 10 correos
          const fetch = imap.fetch(results.slice(0, 10), { bodies: ["HEADER.FIELDS (FROM SUBJECT DATE)"], struct: true });
          
          fetch.on("message", async (msg, seqno) => {
            msg.on("body", async (stream, info) => {
              let buffer = "";
              stream.on("data", chunk => {
                buffer += chunk.toString("utf8");
              });
              stream.once("end", async () => {
                const headers = Imap.parseHeaders(buffer);
                const subject = headers.subject;
                const from = headers.from;
                const date = headers.date;

                console.log(`📤 Correo de: ${from}`);
                console.log(`📌 Asunto: ${subject}`);
                console.log(`🕒 Fecha: ${date}`);

                // Verificar si el correo tiene un asunto válido
                const validSubjects = [
                  "Importante: Cómo actualizar tu Hogar con Netflix",
                  "Tu código de acceso temporal de Netflix",
                  "Completa tu solicitud de restablecimiento de contraseña"
                ];

                if (validSubjects.some(validSubject => subject.includes(validSubject))) {
                  // Obtener el cuerpo del correo
                  const message = await simpleParser(stream);
                  const body = message.text;
                  const link = extractLink(body, [
                    "https://www.netflix.com/account/travel/verify?nftoken=",
                    "https://www.netflix.com/password?g=",
                    "https://www.netflix.com/account/update-primary-location?nftoken="
                  ]);

                  if (link) {
                    imap.end(); // Cerrar la conexión IMAP
                    return { statusCode: 200, body: JSON.stringify({ link: link.replace(/\]$/, "") }) };
                  }
                }
              });
            });
          });

          fetch.once("end", () => {
            console.log("Finalizó la búsqueda de correos.");
            imap.end(); // Cerrar la conexión IMAP
          });
        });
      });
    });

    imap.once("error", (err) => {
      console.error("Error en la conexión IMAP:", err);
      throw err;
    });

    imap.once("end", () => {
      console.log("Conexión IMAP cerrada");
    });

    imap.connect();

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function extractLink(text, validLinks) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  if (matches) {
    console.log("🔗 Enlaces encontrados en el correo:", matches);

    // Buscar enlaces prioritarios como travel/verify y update-primary-location
    const preferredLinks = [
      "https://www.netflix.com/account/travel/verify?nftoken=",
      "https://www.netflix.com/account/update-primary-location?nftoken="
    ];

    const validLink = matches.find(url =>
      preferredLinks.some(valid => url.includes(valid))
    );

    if (validLink) {
      console.log("🔗 Redirigiendo al enlace válido encontrado:", validLink);
      return validLink.replace(/\]$/, "");
    }

    const fallbackLink = matches.find(url => url.includes("https://www.netflix.com/password?g="));

    if (fallbackLink) {
      console.log("🔗 Redirigiendo al enlace de fallback encontrado:", fallbackLink);
      return fallbackLink.replace(/\]$/, "");
    }
  }
  return null;
}
