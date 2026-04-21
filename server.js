require('dotenv').config(); // ✅ load env

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

// ✅ MIDDLEWARE
app.use(cors());
app.use(express.json());

/* =========================
   ROOT + HEALTH
========================= */

// Root route (fixes "Cannot GET /")
app.get('/', (req, res) => {
  res.send("🚀 Rolling Backend API is LIVE");
});

// Health check (important for Render)
app.get('/health', (req, res) => {
  res.json({ status: "OK" });
});

/* =========================
   MONGODB CONNECTION
========================= */

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URL) {
      throw new Error("❌ MONGO_URL missing in .env");
    }

    // ✅ NO options (mongoose v7+)
    await mongoose.connect(process.env.MONGO_URL);

    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ DB Connection Error:", err.message);
    process.exit(1);
  }
};

connectDB();

/* =========================
   ORDER MODEL
========================= */

const orderSchema = new mongoose.Schema({
  type: { type: String, required: true },
  items: { type: Array, default: [] },
  total: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 0 },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

/* =========================
   ROUTES
========================= */

// 🚀 CREATE ORDER
app.post('/order', async (req, res) => {
  try {
    const { type, items, total, riderNearby } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Order type is required"
      });
    }

    const order = new Order({
      type,
      items,
      total,
      deliveryFee: riderNearby ? 0 : 5,
    });

    await order.save();

    res.status(201).json({
      success: true,
      message: "Order created 🚀",
      data: order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 📄 GET ALL ORDERS
app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      count: orders.length,
      data: orders
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 📄 GET SINGLE ORDER
app.get('/orders/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    res.json({
      success: true,
      data: order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔄 UPDATE ORDER STATUS
app.put('/order/:id', async (req, res) => {
  try {
    const { status } = req.body;

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json({
      success: true,
      message: "Order updated",
      data: order
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ❌ DELETE ORDER
app.delete('/order/:id', async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Order deleted"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});