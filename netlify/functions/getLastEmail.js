require("dotenv").config();
const { google } = require("googleapis");
const Imap = require('imap');
const { simpleParser } = require('mailparser');

// Función para generar un retraso aleatorio sin necesidad de `sleep()`
function delay() {
  const delayTime = Math.floor(Math.random() * (9000 - 3000 + 1)) + 3000; // Aleatorio entre 3000ms (3s) y 9000ms (9s)
  return new Promise(resolve => setTimeout(resolve, delayTime)); // Devuelve una promesa que se resuelve después del delay
}

exports.handler = async (event) => {
  try {
    const { email } = JSON.parse(event.body);

    // Inicializamos el cliente OAuth2 para Gmail
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      "https://pruebajajaja.netlify.app/api/auth/callback"
    );

    // Establecemos las credenciales con el refresh_token
    oauth2Client.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });

    // Obtenemos el access_token usando el refresh_token
    const accessToken = await oauth2Client.getAccessToken();

    // Usamos node-imap para conectarnos a Gmail
    const imap = new Imap({
      user: process.env.GMAIL_EMAIL, // Tu correo de Gmail
      xoauth2: accessToken.token, // Usamos el access_token generado
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
    });

    imap.once('ready', function () {
      imap.openBox('INBOX', true, async function (err, box) {
        if (err) {
          console.error("Error al abrir la bandeja de entrada:", err);
          return;
        }

        // Buscar los correos no leídos
        const searchCriteria = ['UNSEEN']; // Buscar correos no leídos
        const fetchOptions = { bodies: ['HEADER', 'TEXT'] };

        const fetch = imap.fetch(searchCriteria, fetchOptions);
        fetch.on('message', async function (msg, seqno) {
          const emailData = {};
          msg.on('body', function (stream) {
            simpleParser(stream, async (err, parsed) => {
              if (err) {
                console.error("Error al analizar el mensaje:", err);
                return;
              }

              emailData.subject = parsed.subject;
              emailData.from = parsed.from.text;
              emailData.date = parsed.date;
              emailData.text = parsed.text;

              console.log("📤 Destinatario del correo:", emailData.from);
              console.log("📌 Asunto encontrado:", emailData.subject);
              console.log("🕒 Fecha del correo:", emailData.date);

              // Filtrar correos por asunto y ver si el correo es para el email indicado
              if (emailData.from.toLowerCase().includes(email.toLowerCase()) &&
                  validSubjects.some(subject => emailData.subject.includes(subject))) {

                // Extraer el cuerpo del mensaje y buscar enlaces válidos
                const link = extractLink(emailData.text);
                if (link) {
                  return { statusCode: 200, body: JSON.stringify({ link: link }) };
                }
              }
            });
          });
        });

        fetch.once('end', function () {
          console.log('Fin de la búsqueda de correos');
          imap.end();
        });
      });
    });

    // Manejo de errores de la conexión IMAP
    imap.once('error', function (err) {
      console.error("Error de IMAP:", err);
    });

    imap.once('end', function () {
      console.log("Conexión IMAP cerrada");
    });

    // Conectar a IMAP
    imap.connect();

  } catch (error) {
    console.error("Error al obtener correos:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

// Filtrar correos por asunto
const validSubjects = [
  "Importante: Cómo actualizar tu Hogar con Netflix",
  "Tu código de acceso temporal de Netflix",
  "Completa tu solicitud de restablecimiento de contraseña"
];

function extractLink(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);
  if (matches) {
    console.log("🔗 Enlaces encontrados en el correo:", matches);

    const preferredLinks = [
      "https://www.netflix.com/account/travel/verify?nftoken=",
      "https://www.netflix.com/account/update-primary-location?nftoken="
    ];

    // Buscar enlaces preferidos
    const validLink = matches.find(url =>
      preferredLinks.some(valid => url.includes(valid))
    );

    if (validLink) {
      console.log("🔗 Redirigiendo al enlace válido encontrado:", validLink);
      return validLink;
    }

    // Buscar fallback si no se encuentra un enlace válido
    const fallbackLink = matches.find(url => url.includes("https://www.netflix.com/password?g="));
    if (fallbackLink) {
      console.log("🔗 Redirigiendo al enlace de fallback encontrado:", fallbackLink);
      return fallbackLink;
    }
  }
  return null;
}
