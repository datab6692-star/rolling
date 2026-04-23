require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const https = require('https');

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

/* =========================
   DRY ERROR HANDLER
========================= */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error("❌ Error:", err.message);
    res.status(500).json({
      success: false,
      message: err.message || "Server Error"
    });
  });
};

/* =========================
   CLOUDINARY CONFIG
========================= */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* =========================
   ROOT + HEALTH
========================= */
app.get('/', (req, res) => {
  res.send("🚀 Rolling Backend API is LIVE");
});

app.get('/health', (req, res) => {
  res.json({ status: "OK" });
});

/* =========================
   MONGODB
========================= */
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ DB Error:", err.message);
    process.exit(1);
  });

/* =========================
   MODELS
========================= */

// PRODUCT
const productSchema = new mongoose.Schema({
  name: { type: String, index: true },
  price: Number,
  image: String,
  category: { type: String, index: true },
}, { timestamps: true });

productSchema.index({ name: "text" });

const Product = mongoose.model('Product', productSchema);

// ORDER
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

/* =========================
   CLOUDINARY UPLOAD FUNCTION (DRY 🔥)
========================= */
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "rolling_products",
        transformation: [
          { width: 400, crop: "scale" },
          { quality: "auto", fetch_format: "auto" }
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

/* =========================
   IMAGE UPLOAD
========================= */
app.post('/upload', upload.single('image'), asyncHandler(async (req, res) => {

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Image file required"
    });
  }

  const result = await uploadToCloudinary(req.file.buffer);

  res.json({
    success: true,
    imageUrl: result.secure_url
  });
}));

/* =========================
   PRODUCT ROUTES (FAST 🚀)
========================= */

// ➕ CREATE PRODUCT
app.post('/product', upload.single('image'), asyncHandler(async (req, res) => {

  const { name, price, category } = req.body;

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
    category,
    image: result.secure_url
  });

  res.status(201).json({
    success: true,
    message: "Product created 🚀",
    data: product
  });
}));

// 📄 GET ALL PRODUCTS
app.get('/products', asyncHandler(async (req, res) => {

  const products = await Product.find()
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  res.json({
    success: true,
    count: products.length,
    data: products
  });
}));

// 🔍 SEARCH
app.get('/search', asyncHandler(async (req, res) => {

  const q = req.query.q;

  if (!q) {
    return res.status(400).json({
      success: false,
      message: "Search query required"
    });
  }

  const products = await Product.find({
    $text: { $search: q }
  })
    .limit(20)
    .lean();

  res.json({
    success: true,
    count: products.length,
    data: products
  });
}));

// 📂 CATEGORY
app.get('/products/category/:category', asyncHandler(async (req, res) => {

  const products = await Product.find({
    category: req.params.category
  })
    .limit(50)
    .lean();

  res.json({
    success: true,
    count: products.length,
    data: products
  });
}));

// 📄 SINGLE
app.get('/product/:id', asyncHandler(async (req, res) => {

  const product = await Product.findById(req.params.id).lean();

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found"
    });
  }

  res.json({
    success: true,
    data: product
  });
}));

// ❌ DELETE
app.delete('/product/:id', asyncHandler(async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ success: true });
}));

/* =========================
   ORDER ROUTES
========================= */

app.post('/order', asyncHandler(async (req, res) => {

  const { type, items, total, riderNearby } = req.body;

  const order = await Order.create({
    type,
    items,
    total,
    deliveryFee: riderNearby ? 0 : 5,
  });

  res.json({
    success: true,
    order
  });
}));

app.get('/orders', asyncHandler(async (req, res) => {

  const orders = await Order.find()
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: orders
  });
}));

app.put('/order/:id', asyncHandler(async (req, res) => {

  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true }
  );

  res.json({
    success: true,
    data: order
  });
}));

app.delete('/order/:id', asyncHandler(async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ success: true });
}));

/* =========================
   KEEP ALIVE (Render fix 🔥)
========================= */
setInterval(() => {
  https.get("https://rolling-bnd6.onrender.com", (res) => {
    console.log("🔁 Ping:", res.statusCode);
  }).on('error', (err) => {
    console.error("Ping failed:", err.message);
  });
}, 14 * 60 * 1000);

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});