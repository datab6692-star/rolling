const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: String,
  productId: String,
  action: String, // view | add_to_cart | order
  category: String,

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('UserActivity', userActivitySchema);