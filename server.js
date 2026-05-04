require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const https = require('https');
const TelegramBot = require('node-telegram-bot-api');

const app = express();

////////////////////////////////////////////////////
/// MIDDLEWARE
////////////////////////////////////////////////////
app.use(cors());
app.use(express.json());

////////////////////////////////////////////////////
/// MONGODB
////////////////////////////////////////////////////
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ DB Error:", err.message);
    process.exit(1);
  });

////////////////////////////////////////////////////
/// 📐 DISTANCE
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
const riderSchema = new mongoose.Schema({
  riderId: String,
  name: String,
  chatId: String,
  isOnline: { type: Boolean, default: false },
  location: {
    lat: Number,
    lng: Number
  }
});
riderSchema.index({ isOnline: 1 });
const Rider = mongoose.model('Rider', riderSchema);

const orderSchema = new mongoose.Schema({
  userId: String,
  items: Array,
  totalAmount: Number,
  address: String,
  phone: String,
  location: {
    lat: Number,
    lng: Number
  },
  riderId: String,
  orderStatus: {
    type: String,
    enum: ['PLACED', 'ACCEPTED', 'PICKED', 'DELIVERED'],
    default: 'PLACED'
  },
  createdAt: { type: Date, default: Date.now }
});
orderSchema.index({ orderStatus: 1 });
const Order = mongoose.model('Order', orderSchema);

////////////////////////////////////////////////////
/// 🤖 TELEGRAM BOT
////////////////////////////////////////////////////
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true
});

const sessions = {};

////////////////////////////////////////////////////
/// 👑 ADMIN CHECK
////////////////////////////////////////////////////
const isAdmin = (chatId) =>
  chatId.toString() === process.env.ADMIN_CHAT_ID;

////////////////////////////////////////////////////
/// 🚀 START COMMAND
////////////////////////////////////////////////////
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  if (isAdmin(chatId)) {
    return bot.sendMessage(chatId, "👑 Admin Panel", {
      reply_markup: {
        keyboard: [
          ["📦 Orders", "👨 Riders"],
          ["⏳ Pending", "🚚 Active"]
        ],
        resize_keyboard: true
      }
    });
  }

  sessions[chatId] = { step: "login" };
  bot.sendMessage(chatId, "Enter Rider ID:");
});

////////////////////////////////////////////////////
/// 📩 MAIN MESSAGE HANDLER
////////////////////////////////////////////////////
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  ////////////////////////////////////////////////////
  /// RIDER LOGIN
  ////////////////////////////////////////////////////
  if (sessions[chatId]?.step === "login") {
    const rider = await Rider.findOne({ riderId: text });

    if (!rider) return bot.sendMessage(chatId, "❌ Invalid ID");

    rider.chatId = chatId;
    await rider.save();

    sessions[chatId] = null;

    return bot.sendMessage(chatId, "✅ Logged in", {
      reply_markup: {
        keyboard: [["🟢 Online", "🔴 Offline"]],
        resize_keyboard: true
      }
    });
  }

  ////////////////////////////////////////////////////
  /// RIDER CONTROLS
  ////////////////////////////////////////////////////
  const rider = await Rider.findOne({ chatId });

  if (rider) {
    if (text === "🟢 Online") {
      rider.isOnline = true;
      await rider.save();

      return bot.sendMessage(chatId, "📍 Send location", {
        reply_markup: {
          keyboard: [[{ text: "Send Location", request_location: true }]],
          resize_keyboard: true
        }
      });
    }

    if (text === "🔴 Offline") {
      rider.isOnline = false;
      await rider.save();
      return bot.sendMessage(chatId, "🔴 Offline");
    }
  }

  ////////////////////////////////////////////////////
  /// ADMIN CONTROLS
  ////////////////////////////////////////////////////
  if (!isAdmin(chatId)) return;

  if (text === "📦 Orders") {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(10);
    for (const o of orders) {
      bot.sendMessage(chatId,
        `🛒 ${o._id}
₹${o.totalAmount}
${o.address}
Status: ${o.orderStatus}`
      );
    }
  }

  if (text === "⏳ Pending") {
    const orders = await Order.find({ orderStatus: "PLACED" });

    for (const o of orders) {
      bot.sendMessage(chatId,
        `⏳ ${o._id}
₹${o.totalAmount}
${o.address}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Assign Rider", callback_data: `assign_${o._id}` }]
            ]
          }
        }
      );
    }
  }

  if (text === "👨 Riders") {
    const riders = await Rider.find();
    for (const r of riders) {
      bot.sendMessage(chatId,
        `👤 ${r.name || r.riderId}
${r.isOnline ? "🟢 Online" : "🔴 Offline"}`
      );
    }
  }

  if (text === "🚚 Active") {
    const orders = await Order.find({
      orderStatus: { $in: ["ACCEPTED", "PICKED"] }
    });

    for (const o of orders) {
      bot.sendMessage(chatId,
        `🚚 ${o._id}
₹${o.totalAmount}
Status: ${o.orderStatus}`
      );
    }
  }
});

////////////////////////////////////////////////////
/// 📍 SAVE LOCATION
////////////////////////////////////////////////////
bot.on("location", async (msg) => {
  const rider = await Rider.findOne({ chatId: msg.chat.id });
  if (!rider) return;

  rider.location = {
    lat: msg.location.latitude,
    lng: msg.location.longitude
  };

  await rider.save();

  bot.sendMessage(msg.chat.id, "✅ Location updated");
});

////////////////////////////////////////////////////
/// 📦 PLACE ORDER
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

    ////////////////////////////////////////////////////
    /// AUTO ASSIGN
    ////////////////////////////////////////////////////
    const riders = await Rider.find({ isOnline: true }).limit(20);

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

    if (nearest && nearest.chatId) {
      await bot.sendMessage(
        nearest.chatId,
        `🛒 New Order
₹${totalAmount}
📞 ${phone}
📍 ${address}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Accept", callback_data: `accept_${order._id}` }],
              [{ text: "❌ Reject", callback_data: `reject_${order._id}` }]
            ]
          }
        }
      );
    }

    res.json({ success: true, orderId: order._id });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

////////////////////////////////////////////////////
/// CALLBACK HANDLER
////////////////////////////////////////////////////
bot.on("callback_query", async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;

  ////////////////////////////////////////////////////
  /// ACCEPT
  ////////////////////////////////////////////////////
  if (data.startsWith("accept")) {
    const orderId = data.split("_")[1];
    const order = await Order.findById(orderId);

    if (order.riderId) {
      return bot.sendMessage(chatId, "⚠️ Already assigned");
    }

    const rider = await Rider.findOne({ chatId });

    order.riderId = rider.riderId;
    order.orderStatus = "ACCEPTED";
    await order.save();

    return bot.sendMessage(chatId, "✅ Accepted", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📦 Picked", callback_data: `picked_${orderId}` }],
          [{ text: "🚚 Delivered", callback_data: `delivered_${orderId}` }]
        ]
      }
    });
  }

  ////////////////////////////////////////////////////
  /// PICKED / DELIVERED
  ////////////////////////////////////////////////////
  if (data.startsWith("picked")) {
    const orderId = data.split("_")[1];
    await Order.findByIdAndUpdate(orderId, { orderStatus: "PICKED" });
    return bot.sendMessage(chatId, "📦 Picked");
  }

  if (data.startsWith("delivered")) {
    const orderId = data.split("_")[1];
    await Order.findByIdAndUpdate(orderId, { orderStatus: "DELIVERED" });
    return bot.sendMessage(chatId, "🎉 Delivered");
  }

  ////////////////////////////////////////////////////
  /// ADMIN ASSIGN
  ////////////////////////////////////////////////////
  if (data.startsWith("assign_")) {
    const orderId = data.split("_")[1];

    const riders = await Rider.find({ isOnline: true });

    const buttons = riders.map(r => ([
      { text: r.name || r.riderId, callback_data: `assignRider_${orderId}_${r._id}` }
    ]));

    return bot.sendMessage(chatId, "Select Rider:", {
      reply_markup: { inline_keyboard: buttons }
    });
  }

  if (data.startsWith("assignRider")) {
    const parts = data.split("_");
    const orderId = parts[1];
    const riderMongoId = parts[2];

    const rider = await Rider.findById(riderMongoId);

    await Order.findByIdAndUpdate(orderId, {
      riderId: rider.riderId,
      orderStatus: "ACCEPTED"
    });

    await bot.sendMessage(rider.chatId, `🛒 Assigned Order ${orderId}`);
    return bot.sendMessage(chatId, "✅ Assigned");
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
  console.log(`🚀 Running on ${PORT}`);
});