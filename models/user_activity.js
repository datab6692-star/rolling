const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  category: String,
  action: {
    type: String,
    enum: ['view', 'order'],
    required: true
  }
}, { timestamps: true });

module.exports =
  mongoose.models.UserActivity ||
  mongoose.model('UserActivity', userActivitySchema);