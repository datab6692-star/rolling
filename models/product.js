const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  oldPrice: Number,
  image: String,
  category: String,
}, { timestamps: true });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);