const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ✅ ROOT ROUTE (no more "Cannot GET /")
app.get('/', (req, res) => {
  res.send("🚀 Rolling Backend API is running");
});

// ✅ CONNECT MONGODB (ENV VARIABLE)
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ DB Error:", err));

// ✅ ORDER MODEL
const orderSchema = new mongoose.Schema({
  type: String,
  items: Array,
  total: Number,
  deliveryFee: Number,
  status: String,
  createdAt: Date
});

const Order = mongoose.model('Order', orderSchema);

// 🚀 CREATE ORDER
app.post('/order', async (req, res) => {
  try {
    const { type, items, total, riderNearby } = req.body;

    const order = new Order({
      type,
      items: items || [],
      total: total || 0,
      deliveryFee: riderNearby ? 0 : 5,
      status: 'pending',
      createdAt: new Date()
    });

    await order.save();

    res.json({
      success: true,
      message: "Order saved 🚀",
      order
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

// 🚀 PORT FIX (IMPORTANT FOR RENDER)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});