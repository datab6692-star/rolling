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
    console.error("❌ Error:", err.message);
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
/// 📍 DELIVERY CENTER (CHANGE THIS 🔥)
////////////////////////////////////////////////////
const STORE_LAT = 17.425814; // 👉 change to your shop location
const STORE_LNG = 78.649177;

////////////////////////////////////////////////////
/// 📐 HAVERSINE (DISTANCE)
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

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

////////////////////////////////////////////////////
/// MODELS (SAFE)
////////////////////////////////////////////////////
const productSchema = new mongoose.Schema({
  name: { type: String, index: true },
  price: { type: Number, required: true },
  oldPrice: Number,
  image: String,
  category: String,
}, { timestamps: true });

productSchema.index({ name: "text", category: "text" });

const Product =
  mongoose.models.Product ||
  mongoose.model('Product', productSchema);

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

const Order =
  mongoose.models.Order ||
  mongoose.model('Order', orderSchema);

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
/// 📍 CHECK DELIVERY ZONE
////////////////////////////////////////////////////
app.post('/check-zone', asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      message: "lat & lng required",
    });
  }

  const distance = getDistanceKm(lat, lng, STORE_LAT, STORE_LNG);

  const inZone = distance <= 2;

  res.json({
    success: true,
    inZone,
    distance: Number(distance.toFixed(2)),
    message: inZone
      ? "Delivery available 🚀"
      : "Out of delivery zone",
  });
}));

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
/// PRODUCTS
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
    category,
    image: result.secure_url
  });

  res.status(201).json({ success: true, data: product });
}));

app.get('/products', asyncHandler(async (req, res) => {
  const products = await Product.find()
    .sort({ createdAt: -1 })
    .limit(100);

  res.json({ success: true, data: products });
}));

////////////////////////////////////////////////////
/// ORDER
////////////////////////////////////////////////////
app.post('/order', asyncHandler(async (req, res) => {
  const { type, items, total, riderNearby, userId } = req.body;

  const order = await Order.create({
    type,
    items,
    total,
    deliveryFee: riderNearby ? 0 : 5,
  });

  res.json({ success: true, order });
}));

////////////////////////////////////////////////////
/// RECOMMEND
////////////////////////////////////////////////////
app.get('/recommend/:userId', asyncHandler(async (req, res) => {
  const products = await Product.find().limit(10);
  res.json({ success: true, data: products });
}));

////////////////////////////////////////////////////
/// KEEP ALIVE
////////////////////////////////////////////////////
setInterval(() => {
  https.get("https://rolling-bnd6.onrender.com", () => {});
}, 14 * 60 * 1000);

////////////////////////////////////////////////////
/// SERVER
////////////////////////////////////////////////////
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});