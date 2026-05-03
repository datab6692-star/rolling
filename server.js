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
  name: { type: String, index: true },
  price: { type: Number, required: true },
  oldPrice: Number,
  image: String,
  category: String,
}, { timestamps: true });

productSchema.index({ name: "text", category: "text" });

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
  type: String,
  items: Array,
  total: Number,
  deliveryFee: Number,
  status: {
    type: String,
    enum: ['pending', 'accepted', 'picked', 'delivered'],
    default: 'pending'
  }
}, { timestamps: true });

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

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
/// 🔍 LOCATION SEARCH
////////////////////////////////////////////////////
app.get('/place-search', asyncHandler(async (req, res) => {
  const { query, lat, lon } = req.query;

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
/// 🔥 PRODUCTS FILTER API (IMPORTANT)
////////////////////////////////////////////////////
app.get('/products', asyncHandler(async (req, res) => {
  const { category, maxPrice, search } = req.query;

  let query = {};

  if (category) {
    query.category = new RegExp(category, 'i');
  }

  if (maxPrice) {
    query.price = { $lte: Number(maxPrice) };
  }

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
/// 🔥 PRODUCT DETAIL
////////////////////////////////////////////////////
app.get('/products/:id', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    return res.status(404).json({ success: false });
  }

  res.json({ success: true, data: product });
}));

////////////////////////////////////////////////////
/// 🔍 SEARCH (ADVANCED)
////////////////////////////////////////////////////
app.get('/search', asyncHandler(async (req, res) => {
  const query = req.query.q;

  if (!query) return res.json({ success: true, data: [] });

  const products = await Product.find({
    $or: [
      { name: { $regex: query, $options: 'i' } },
      { category: { $regex: query, $options: 'i' } }
    ]
  }).limit(20);

  res.json({ success: true, data: products });
}));

////////////////////////////////////////////////////
/// 🛒 ORDER
////////////////////////////////////////////////////
app.post('/order', asyncHandler(async (req, res) => {
  const { type, items, total, riderNearby } = req.body;

  const order = await Order.create({
    type,
    items,
    total,
    deliveryFee: riderNearby ? 0 : 5,
  });

  res.json({ success: true, order });
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