require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const https = require('https');

const app = express();

////////////////////////////////////////////////////
/// MIDDLEWARE
////////////////////////////////////////////////////
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

////////////////////////////////////////////////////
/// ERROR HANDLER
////////////////////////////////////////////////////
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error("❌ Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server Error",
    });
  });
};

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
app.get('/', (req, res) => {
  res.send("🚀 Rolling Backend API is LIVE");
});

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
/// MODELS
////////////////////////////////////////////////////
const productSchema = new mongoose.Schema({
  name: { type: String, index: true },
  price: { type: Number, required: true },
  oldPrice: Number,
  image: String,
  category: { type: String, index: true },
}, { timestamps: true });

productSchema.index({ name: "text", category: "text" });

const Product = mongoose.model('Product', productSchema);

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

const Order = mongoose.model('Order', orderSchema);

const UserActivity = require('./models/user_activity');

////////////////////////////////////////////////////
/// CLOUDINARY UPLOAD
////////////////////////////////////////////////////
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "rolling_products",
        transformation: [
          { width: 400, crop: "scale" },
          { quality: "auto" }
        ]
      },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );
    stream.end(buffer);
  });
};

////////////////////////////////////////////////////
/// 🔍 SEARCH
////////////////////////////////////////////////////
app.get('/search', asyncHandler(async (req, res) => {
  const query = req.query.q;

  if (!query || query.trim() === "") {
    return res.json({ success: true, data: [] });
  }

  let products = await Product.find(
    { $text: { $search: query } },
    { score: { $meta: "textScore" } }
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(20);

  if (products.length === 0) {
    products = await Product.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } }
      ]
    }).limit(20);
  }

  res.json({ success: true, data: products });
}));

////////////////////////////////////////////////////
/// ➕ CREATE PRODUCT
////////////////////////////////////////////////////
app.post('/product', upload.single('image'), asyncHandler(async (req, res) => {
  const { name, price, oldPrice, category } = req.body;

  if (!name || !price || !req.file) {
    return res.status(400).json({
      success: false,
      message: "Name, price, image required"
    });
  }

  const result = await uploadToCloudinary(req.file.buffer);

  const product = await Product.create({
    name,
    price,
    oldPrice: oldPrice || Math.round(price * 1.2),
    category: category?.trim(),
    image: result.secure_url
  });

  res.status(201).json({ success: true, data: product });
}));

////////////////////////////////////////////////////
/// 📦 GET PRODUCTS
////////////////////////////////////////////////////
app.get('/products', asyncHandler(async (req, res) => {
  const { category, limit = 100 } = req.query;

  let filter = {};

  if (category) {
    filter.category = {
      $regex: `^${category.trim()}$`,
      $options: 'i'
    };
  }

  const products = await Product.find(filter)
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  res.json({ success: true, data: products });
}));

////////////////////////////////////////////////////
/// 📍 CHECK DELIVERY ZONE (🔥 NEW)
////////////////////////////////////////////////////
app.post('/check-zone', asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      message: "lat & lng required"
    });
  }

  // Example: Hyderabad center
  const centerLat = 17.3850;
  const centerLng = 78.4867;
  const maxDistanceKm = 2;

  const distance = getDistance(lat, lng, centerLat, centerLng);

  const inZone = distance <= maxDistanceKm;

  res.json({
    success: true,
    inZone,
    distance: distance.toFixed(2),
    message: inZone
      ? "Delivery available 🚀"
      : "Out of delivery zone"
  });
}));

////////////////////////////////////////////////////
/// 📐 HAVERSINE FORMULA
////////////////////////////////////////////////////
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

////////////////////////////////////////////////////
/// 🎯 RECOMMENDATION
////////////////////////////////////////////////////
app.get('/recommend/:userId', asyncHandler(async (req, res) => {
  const userId = req.params.userId;

  const activities = await UserActivity.find({
    userId,
    action: "view"
  });

  if (activities.length === 0) {
    const products = await Product.find().limit(10);
    return res.json({ success: true, data: products });
  }

  const categoryCount = {};

  activities.forEach(a => {
    if (!a.category) return;
    categoryCount[a.category] = (categoryCount[a.category] || 0) + 1;
  });

  const topCategory = Object.keys(categoryCount).sort(
    (a, b) => categoryCount[b] - categoryCount[a]
  )[0];

  const recommended = await Product.find({
    category: topCategory
  }).limit(10);

  res.json({ success: true, data: recommended });
}));

////////////////////////////////////////////////////
/// KEEP ALIVE
////////////////////////////////////////////////////
setInterval(() => {
  https.get(process.env.BASE_URL || "https://rolling-bnd6.onrender.com");
}, 14 * 60 * 1000);

////////////////////////////////////////////////////
/// SERVER
////////////////////////////////////////////////////
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});