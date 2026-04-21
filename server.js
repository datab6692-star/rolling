require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const app = express();

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

// ✅ Use memory storage (important for Render)
const upload = multer({ storage: multer.memoryStorage() });

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
   MONGODB CONNECTION
========================= */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ DB Error:", err.message);
    process.exit(1);
  }
};

connectDB();

/* =========================
   MODELS
========================= */

// 📦 PRODUCT
const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  image: String,
  category: String,
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// 🧾 ORDER
const orderSchema = new mongoose.Schema({
  type: String,
  items: Array,
  total: Number,
  deliveryFee: Number,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

/* =========================
   IMAGE UPLOAD ROUTE
========================= */

// 📸 Upload image only
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "rolling_products" },
        (error, result) => {
          if (result) resolve(result);
          else reject(error);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({
      success: true,
      imageUrl: result.secure_url
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   PRODUCT ROUTES
========================= */

// ➕ CREATE PRODUCT WITH IMAGE
app.post('/product', upload.single('image'), async (req, res) => {
  try {
    const { name, price, category } = req.body;

    if (!name || !price || !req.file) {
      return res.status(400).json({
        success: false,
        message: "Name, price, image required"
      });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "rolling_products",
          transformation: [{ width: 500, height: 500, crop: "fill" }]
        },
        (error, result) => {
          if (result) resolve(result);
          else reject(error);
        }
      );
      stream.end(req.file.buffer);
    });

    const product = new Product({
      name,
      price,
      category,
      image: result.secure_url
    });

    await product.save();

    res.status(201).json({
      success: true,
      message: "Product created 🚀",
      data: product
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📄 GET ALL PRODUCTS
app.get('/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json(products);
});

// 📄 GET SINGLE PRODUCT
app.get('/product/:id', async (req, res) => {
  const product = await Product.findById(req.params.id);
  res.json(product);
});

// ❌ DELETE PRODUCT
app.delete('/product/:id', async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

/* =========================
   ORDER ROUTES
========================= */

// 🚀 CREATE ORDER
app.post('/order', async (req, res) => {
  const { type, items, total, riderNearby } = req.body;

  const order = new Order({
    type,
    items,
    total,
    deliveryFee: riderNearby ? 0 : 5,
  });

  await order.save();

  res.json(order);
});

// 📄 GET ALL ORDERS
app.get('/orders', async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

// 🔄 UPDATE ORDER
app.put('/order/:id', async (req, res) => {
  const { status } = req.body;

  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  );

  res.json(order);
});

// ❌ DELETE ORDER
app.delete('/order/:id', async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});