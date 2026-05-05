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
/// DB CONNECT
////////////////////////////////////////////////////
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ DB Error:", err.message);
    process.exit(1);
  });

////////////////////////////////////////////////////
/// 📐 DISTANCE FUNCTION
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
/// 🛒 MODELS
////////////////////////////////////////////////////
const Product = mongoose.model('Product', new mongoose.Schema({
  name: String,
  price: Number,
  image: String,
  category: String,
  inStock: { type: Boolean, default: true }
}));

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
/// 🤖 TELEGRAM BOT (FIXED)
////////////////////////////////////////////////////
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
});

const isAdmin = (chatId) =>
  chatId.toString() === process.env.ADMIN_CHAT_ID;

////////////////////////////////////////////////////
/// 📍 CHECK ZONE (🔥 2KM ONLY)
////////////////////////////////////////////////////
app.post('/check-zone', (req, res) => {
  const { lat, lng } = req.body;

  const centerLat = 17.4258;
  const centerLng = 78.6492;

  const distance = getDistanceKm(lat, lng, centerLat, centerLng);

  const inZone = distance <= 2; // 🔥 ONLY 2 KM

  res.json({
    success: true,
    inZone,
    distance,
    eta: inZone ? "10 mins" : "--",
    message: inZone
      ? "Delivery available 🚀"
      : "Coming soon to your area"
  });
});

////////////////////////////////////////////////////
/// 🛒 GET PRODUCTS (REAL)
////////////////////////////////////////////////////
app.get('/products', async (req, res) => {
  try {
    const products = await Product.find({ inStock: true });

    res.json(products);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

////////////////////////////////////////////////////
/// ➕ ADD PRODUCT (TEST)
////////////////////////////////////////////////////
app.post('/add-product', async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.json({ success: true, product });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    /// 🚀 AUTO ASSIGN RIDER
    ////////////////////////////////////////////////////
    const riders = await Rider.find({ isOnline: true });

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
      bot.sendMessage(
        nearest.chatId,
        `🛒 New Order
₹${totalAmount}
📞 ${phone}
📍 ${address}`
      );
    }

    res.json({ success: true, orderId: order._id });

  } catch (e) {
    console.error(e);
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
  https.get(process.env.BASE_URL);
}, 14 * 60 * 1000);

////////////////////////////////////////////////////
/// SERVER
////////////////////////////////////////////////////
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});