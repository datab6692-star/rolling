const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
// ✅ CONNECT MONGODB
mongoose.connect('mongodb+srv://admin:admin123@cluster0.gk3y8lc.mongodb.net/rolling_store')
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log(err));

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
      message: "Order saved to DB 🚀",
      order
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📄 GET ALL ORDERS
app.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🚀 START SERVER
app.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});