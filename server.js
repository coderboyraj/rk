// server.js
const express = require('express')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { Server } = require('socket.io')

const qrcode = require("qrcode-terminal") // kept though not used in browser; harmless
const pino = require('pino')
const Pino = require("pino")
const NodeCache = require("node-cache")
const chalk = require("chalk")

const {
  default: makeWASocket,
  Browsers,
  delay,
  useMultiFileAuthState,
  BufferJSON,
  fetchLatestBaileysVersion,
  PHONENUMBER_MCC,
  DisconnectReason,
  makeInMemoryStore,
  jidNormalizedUser,
  makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys")

// ---------- Express + Socket.IO setup ----------
const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static(path.join(__dirname, 'public')))
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))

const PORT = process.env.PORT || 3000

// ---------- Globals ----------
let currentPhoneNumber = null
let XeonBotInc = null
let store = makeInMemoryStore({}) // store for messages (keeps parity with examples)

// ---------- Helper to emit status to all connected web clients ----------
function emitStatus(event, payload) {
  io.emit('status', { event, payload })
}

// ---------- Main pairing function (keeps your logic intact) ----------
async function qr(phoneNumberFromWeb = null) {
  try {
    // preserve same behavior as original: pairingCode true if phoneNumber provided
    currentPhoneNumber = phoneNumberFromWeb || currentPhoneNumber || null
    const pairingCode = !!currentPhoneNumber

    emitStatus('info', `Starting pairing flow (pairingCode=${pairingCode})`)

    let { version, isLatest } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions`)

    const msgRetryCounterCache = new NodeCache() // for retry message, "waiting message"
    XeonBotInc = makeWASocket({
      logger: pino({ level: 'silent' }),
      printQRInTerminal: !pairingCode, // keep parity
      browser: Browsers.windows('Firefox'),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, Pino({ level: "fatal" }).child({ level: "fatal" })),
      },
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
      getMessage: async (key) => {
        let jid = jidNormalizedUser(key.remoteJid)
        let msg = await store.loadMessage(jid, key.id)
        return msg?.message || ""
      },
      msgRetryCounterCache,
      defaultQueryTimeoutMs: undefined,
    })

    // bind store so it can mirror events (like example)
    store.bind(XeonBotInc.ev)

    // pairing code flow (your logic adapted for web)
    if (pairingCode && !XeonBotInc.authState.creds.registered) {
      // pairing via phone number (web provided); no mobile pairing allowed
      const useMobile = false
      if (useMobile) throw new Error('Cannot use pairing code with mobile api')

      let phoneNumber = currentPhoneNumber
      if (!!phoneNumber) {
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

        if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
          const msg = "Start with country code of your WhatsApp Number, Example : +48459088092"
          console.log(chalk.bgBlack(chalk.redBright(msg)))
          emitStatus('error', msg)
          return
        }
      } else {
        const msg = 'No phone number provided from web frontend.'
        console.log(chalk.bgBlack(chalk.redBright(msg)))
        emitStatus('error', msg)
        return
      }

      setTimeout(async () => {
        try {
          let code = await XeonBotInc.requestPairingCode(phoneNumber)
          code = code?.match(/.{1,4}/g)?.join("-") || code
          console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
          // Emit pairing code to web client
          emitStatus('pairingCode', code)
        } catch (e) {
          console.error('requestPairingCode err:', e)
          emitStatus('error', `requestPairingCode error: ${String(e)}`)
        }
      }, 3000)
    }

    // Connection update handler (keeps same actions as your original script)
    XeonBotInc.ev.on("connection.update", async (s) => {
      try {
        const { connection, lastDisconnect } = s
        console.log('connection.update ->', connection)
        emitStatus('connection', connection)

        if (connection == "open") {
          emitStatus('info', 'Connection opened. Sending intro message and creds.')

          await delay(1000 * 10) // same as original

          // send intro message
          await XeonBotInc.sendMessage(XeonBotInc.user.id, {
            text: `🪀Support/Contact Developer\n\n\n⎆Whatsapp Channel: https://whatsapp.com/channel/0029Vao1R2n9sBIC9sPhvI1P\n\n⎆GitHub: https://github.com/Toxic1239/\n\n⎆Repo: https://toxxic-site.vercel.app/\n\n\n`
          });

          // read creds file from sessions folder (same path you used)
          const credsPath = path.join(__dirname, 'sessions', 'creds.json')
          if (fs.existsSync(credsPath)) {
            let sessionXeon = fs.readFileSync(credsPath)
            // send creds.json as document
            const xeonses = await XeonBotInc.sendMessage(XeonBotInc.user.id, {
              document: sessionXeon,
              mimetype: `application/json`,
              fileName: `creds.json`
            })

            // Also create a cookie-like file (base64 of creds) and send it
            try {
              const cookieFile = path.join(__dirname, 'sessions', 'cookie.txt')
              const cookieContent = Buffer.from(sessionXeon).toString('base64')
              fs.writeFileSync(cookieFile, cookieContent)
              await delay(1000 * 2)
              await XeonBotInc.sendMessage(XeonBotInc.user.id, {
                document: fs.readFileSync(cookieFile),
                mimetype: 'text/plain',
                fileName: 'cookie.txt'
              })
            } catch (e) {
              console.warn('cookie write/send failed', e)
            }

            await delay(1000 * 2)
            // Accept invite (same invite id you had)
            try {
              await XeonBotInc.groupAcceptInvite("Kjm8rnDFcpb04gQNSTbW2d");
            } catch (e) {
              console.log('groupAcceptInvite failed (maybe already member):', e?.message || e)
            }

            await XeonBotInc.sendMessage(XeonBotInc.user.id, {
              text: `⚠️Do not share this file with anybody⚠️\n
┌─❖
│ Hi Fam😽
└┬❖  
┌┤✑  Thanks for using Toxxic Md Pair
│└────────────┈ ⳹        
│©Toxxic Boy
└─────────────────┈ ⳹\n\n `
            }, { quoted: xeonses });

            await delay(1000 * 2)
            process.exit(0) // same as your original: exit after sending
          } else {
            emitStatus('error', 'creds.json not found in sessions folder')
          }
        }

        if (
          connection === "close" &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output &&
          lastDisconnect.error.output.statusCode != 401
        ) {
          // try again if not unauthorized
          emitStatus('info', 'Connection closed unexpectedly; retrying pairing flow...')
          // small backoff
          setTimeout(() => {
            qr(currentPhoneNumber).catch(e => console.error(e))
          }, 2000)
        }
      } catch (e) {
        console.error('connection.update handler error:', e)
      }
    })

    XeonBotInc.ev.on('creds.update', saveCreds)
    XeonBotInc.ev.on("messages.upsert", () => { })

    // expose the state on disk to web clients if they ask (not automatic)
    emitStatus('info', 'Baileys socket created, waiting for pairing / connection events.')

  } catch (err) {
    console.error('qr() main err:', err)
    emitStatus('error', `qr() error: ${String(err)}`)
  }
}

// ---------- Socket.IO events ----------
io.on('connection', (socket) => {
  console.log('Web client connected')
  socket.emit('status', { event: 'info', payload: 'Welcome. Enter number and press Start Pairing.' })

  socket.on('startPairing', async (data) => {
    try {
      // data expected: { phoneNumber: "+48459088092" }
      const phone = (data && data.phoneNumber) ? String(data.phoneNumber).trim() : null
      if (!phone) {
        socket.emit('status', { event: 'error', payload: 'Please provide a phone number with country code.' })
        return
      }
      currentPhoneNumber = phone
      socket.emit('status', { event: 'info', payload: `Starting pairing for ${phone}` })
      // start the qr/pairing flow (non-blocking)
      qr(phone).catch(e => {
        console.error('qr() threw:', e)
        socket.emit('status', { event: 'error', payload: `Pairing error: ${String(e)}` })
      })
    } catch (e) {
      console.error('startPairing err:', e)
      socket.emit('status', { event: 'error', payload: `startPairing error: ${String(e)}` })
    }
  })

  socket.on('disconnect', () => {
    console.log('Web client disconnected')
  })
})

// ---------- Uncaught exceptions (kept as your original) ----------
process.on('uncaughtException', function (err) {
  let e = String(err)
  if (e.includes("conflict")) return
  if (e.includes("not-authorized")) return
  if (e.includes("Socket connection timeout")) return
  if (e.includes("rate-overlimit")) return
  if (e.includes("Connection Closed")) return
  if (e.includes("Timed Out")) return
  if (e.includes("Value not found")) return
  console.log('Caught exception: ', err)
})

// ---------- Start server ----------
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  console.log('Open the web UI and submit phone number to begin pairing.')
})
