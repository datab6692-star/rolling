require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

////////////////////////////////////////////////////
/// DB CONNECT
////////////////////////////////////////////////////
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ DB Error:", err.message);
    process.exit(1);
  });

////////////////////////////////////////////////////
/// DISTANCE FUNCTION
////////////////////////////////////////////////////
const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

////////////////////////////////////////////////////
/// MODELS
////////////////////////////////////////////////////
const Rider = mongoose.model('Rider', new mongoose.Schema({
  riderId: String,
  name: String,
  chatId: String,
  isOnline: { type: Boolean, default: false },
  location: { lat: Number, lng: Number }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
  userId: String,
  items: Array,
  totalAmount: Number,
  address: String,
  phone: String,
  location: { lat: Number, lng: Number },
  riderId: String,
  orderStatus: {
    type: String,
    enum: ['PLACED', 'ACCEPTED', 'PICKED', 'DELIVERED'],
    default: 'PLACED'
  },
  createdAt: { type: Date, default: Date.now }
}));

////////////////////////////////////////////////////
/// TELEGRAM BOT (ONLY RUN IN PRODUCTION)
////////////////////////////////////////////////////
let bot;

if (process.env.NODE_ENV === "production") {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: true
  });
  console.log("🤖 Bot started (production)");
} else {
  console.log("⚠️ Bot disabled (local)");
}

const sessions = {};

const isAdmin = (chatId) =>
  chatId.toString() === process.env.ADMIN_CHAT_ID;

////////////////////////////////////////////////////
/// SAFE SEND
////////////////////////////////////////////////////
const safeSend = async (chatId, text, options = {}) => {
  try {
    if (bot) await bot.sendMessage(chatId, text, options);
  } catch (e) {
    console.log("❌ Telegram Error:", e.message);
  }
};

////////////////////////////////////////////////////
/// BOT HANDLERS
////////////////////////////////////////////////////
if (bot) {

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;

    if (isAdmin(chatId)) {
      return safeSend(chatId, "👑 Admin Panel", {
        reply_markup: {
          keyboard: [
            ["📦 Orders", "👨 Riders"]
          ],
          resize_keyboard: true
        }
      });
    }

    sessions[chatId] = { step: "login" };
    safeSend(chatId, "Enter Rider ID:");
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (sessions[chatId]?.step === "login") {
      const rider = await Rider.findOne({ riderId: text });

      if (!rider) return safeSend(chatId, "❌ Invalid ID");

      rider.chatId = chatId;
      await rider.save();

      sessions[chatId] = null;

      return safeSend(chatId, "✅ Logged in", {
        reply_markup: {
          keyboard: [["🟢 Online", "🔴 Offline"]],
          resize_keyboard: true
        }
      });
    }

    const rider = await Rider.findOne({ chatId });

    if (rider) {
      if (text === "🟢 Online") {
        rider.isOnline = true;
        await rider.save();

        return safeSend(chatId, "📍 Send location", {
          reply_markup: {
            keyboard: [[{ text: "Send Location", request_location: true }]],
            resize_keyboard: true
          }
        });
      }

      if (text === "🔴 Offline") {
        rider.isOnline = false;
        await rider.save();
        return safeSend(chatId, "🔴 Offline");
      }
    }
  });

  bot.on("location", async (msg) => {
    const rider = await Rider.findOne({ chatId: msg.chat.id });
    if (!rider) return;

    rider.location = {
      lat: msg.location.latitude,
      lng: msg.location.longitude
    };

    await rider.save();
    safeSend(msg.chat.id, "✅ Location updated");
  });

  bot.on("callback_query", async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data.startsWith("accept")) {
      const orderId = data.split("_")[1];
      const order = await Order.findById(orderId);

      if (order.riderId) {
        return safeSend(chatId, "⚠️ Already assigned");
      }

      const rider = await Rider.findOne({ chatId });

      order.riderId = rider.riderId;
      order.orderStatus = "ACCEPTED";
      await order.save();

      return safeSend(chatId, "✅ Accepted");
    }
  });
}

////////////////////////////////////////////////////
/// 📍 CHECK ZONE (2KM)
////////////////////////////////////////////////////
app.post('/check-zone', (req, res) => {
  try {
    const { lat, lng } = req.body;

    const centerLat = 17.4258;
    const centerLng = 78.6492;

    const distance = getDistanceKm(lat, lng, centerLat, centerLng);

    const SERVICE_RADIUS_KM = 2; // 🔥 FINAL

    const inZone = distance <= SERVICE_RADIUS_KM;

    res.json({
      success: true,
      inZone,
      distance: Number(distance.toFixed(2)),
      eta: inZone ? "10 mins" : "--",
      message: inZone
        ? "Delivery in 10 mins 🚀"
        : "Only within 2 KM 😔",
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      inZone: false,
      message: "Server error",
    });
  }
});

////////////////////////////////////////////////////
/// ORDER API
////////////////////////////////////////////////////
app.post('/order', async (req, res) => {
  try {
    const { userId, items, totalAmount, address, phone, lat, lng } = req.body;

    const order = await Order.create({
      userId,
      items,
      totalAmount,
      address,
      phone,
      location: { lat, lng }
    });

    const riders = await Rider.find({ isOnline: true }).limit(10);

    let nearest = null;
    let minDistance = Infinity;

    for (const r of riders) {
      if (!r.location) continue;

      const dist = getDistanceKm(lat, lng, r.location.lat, r.location.lng);

      if (dist < minDistance) {
        minDistance = dist;
        nearest = r;
      }
    }

    if (nearest?.chatId) {
      safeSend(
        nearest.chatId,
`🛒 New Order
₹${totalAmount}
📞 ${phone}
📍 ${address}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Accept", callback_data: `accept_${order._id}` }]
            ]
          }
        }
      );
    }

    res.json({ success: true, orderId: order._id });

  } catch (e) {
    console.error("❌ Order Error:", e.message);
    res.status(500).json({ success: false });
  }
});

////////////////////////////////////////////////////
/// ROOT
////////////////////////////////////////////////////
app.get('/', (_, res) => res.send("🚀 Backend LIVE"));

////////////////////////////////////////////////////
/// KEEP ALIVE
////////////////////////////////////////////////////
setInterval(() => {
  https.get(process.env.BASE_URL, () => {});
}, 14 * 60 * 1000);

////////////////////////////////////////////////////
/// SERVER
////////////////////////////////////////////////////
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});