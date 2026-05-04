require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const https = require('https');
const axios = require('axios');

const app = express();

////////////////////////////////////////////////////
/// MIDDLEWARE
////////////////////////////////////////////////////
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

////////////////////////////////////////////////////
/// DEBUG
////////////////////////////////////////////////////
console.log("🔑 GEOAPIFY:", process.env.GEOAPIFY_KEY ? "OK ✅" : "MISSING ❌");

////////////////////////////////////////////////////
/// ASYNC HANDLER
////////////////////////////////////////////////////
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error("❌ ERROR:", err.message);
    res.status(500).json({ success: false, message: err.message });
  });

////////////////////////////////////////////////////
/// CLOUDINARY
////////////////////////////////////////////////////
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

////////////////////////////////////////////////////
/// ROOT
////////////////////////////////////////////////////
app.get('/', (_, res) => res.send("🚀 Backend LIVE"));

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
/// 📍 DELIVERY CENTER
////////////////////////////////////////////////////
const STORE_LAT = 17.425814;
const STORE_LNG = 78.649177;

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
const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  oldPrice: Number,
  image: String,
  category: String,
}, { timestamps: true });

const Product = mongoose.model('Product', productSchema);

////////////////////////////////////////////////////
/// 🔥 UPDATED ORDER MODEL (PAYMENT READY)
////////////////////////////////////////////////////
const orderSchema = new mongoose.Schema({
  userId: String,
  items: Array,
  totalAmount: Number,
  address: String,

  paymentMethod: {
    type: String,
    enum: ['COD', 'UPI'],
  },

  paymentStatus: {
    type: String,
    enum: ['COD', 'PENDING', 'PAID', 'FAILED'],
    default: 'PENDING',
  },

  orderStatus: {
    type: String,
    enum: ['PLACED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'],
    default: 'PLACED',
  },

  createdAt: {
    type: Date,
    default: Date.now,
  }
});

const Order = mongoose.model('Order', orderSchema);

////////////////////////////////////////////////////
/// 📍 CHECK ZONE
////////////////////////////////////////////////////
app.post('/check-zone', asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;

  const distance = getDistanceKm(lat, lng, STORE_LAT, STORE_LNG);

  res.json({
    success: true,
    inZone: distance <= 2,
    distance: Number(distance.toFixed(2)),
  });
}));

////////////////////////////////////////////////////
/// 🔍 LOCATION SEARCH (FIXED URL 🔥)
////////////////////////////////////////////////////
app.get('/place-search', asyncHandler(async (req, res) => {
  const { query } = req.query;

  if (!query) return res.json([]);

  const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&limit=10&apiKey=${process.env.GEOAPIFY_KEY}`;

  const response = await axios.get(url);

  const results = response.data.features.map((f) => ({
    name: f.properties.name || "Unknown",
    address: f.properties.formatted,
    lat: f.properties.lat,
    lon: f.properties.lon,
  }));

  res.json(results);
}));

////////////////////////////////////////////////////
/// 🔥 PRODUCTS FILTER API
////////////////////////////////////////////////////
app.get('/products', asyncHandler(async (req, res) => {
  const { category, maxPrice, search } = req.query;

  let query = {};

  if (category) query.category = new RegExp(category, 'i');
  if (maxPrice) query.price = { $lte: Number(maxPrice) };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } }
    ];
  }

  const products = await Product.find(query).limit(100);

  res.json({ success: true, data: products });
}));

////////////////////////////////////////////////////
/// 🔍 SEARCH
////////////////////////////////////////////////////
app.get('/search', asyncHandler(async (req, res) => {
  const q = req.query.q;

  if (!q) return res.json({ success: true, data: [] });

  const products = await Product.find({
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { category: { $regex: q, $options: 'i' } }
    ]
  });

  res.json({ success: true, data: products });
}));

////////////////////////////////////////////////////
/// 🛒 PLACE ORDER (UPDATED 🔥)
////////////////////////////////////////////////////
app.post('/order', asyncHandler(async (req, res) => {
  const {
    userId,
    items,
    totalAmount,
    address,
    paymentMethod
  } = req.body;

  const order = await Order.create({
    userId,
    items,
    totalAmount,
    address,
    paymentMethod,
    paymentStatus: paymentMethod === "COD" ? "COD" : "PENDING"
  });

  res.json({
    success: true,
    orderId: order._id,
  });
}));

////////////////////////////////////////////////////
/// 🔥 VERIFY PAYMENT
////////////////////////////////////////////////////
app.post('/verify-payment', asyncHandler(async (req, res) => {
  const { orderId, status } = req.body;

  const order = await Order.findById(orderId);
  if (!order) return res.json({ success: false });

  order.paymentStatus = status;
  await order.save();

  console.log("✅ Payment updated:", orderId, status);

  res.json({ success: true });
}));

////////////////////////////////////////////////////
/// 🤖 TELEGRAM ALERT
////////////////////////////////////////////////////
app.post('/telegram-alert', asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  const order = await Order.findById(orderId);
  if (!order) return res.json({ success: false });

  const message = `
🚨 Payment not verified

Order: ${order._id}
Amount: ₹${order.totalAmount}
`;

  await axios.post(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
    }
  );

  res.json({ success: true });
}));

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