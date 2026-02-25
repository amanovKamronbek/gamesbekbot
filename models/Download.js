import mongoose from "mongoose";

const schema = new mongoose.Schema({
  userId: Number,
  code: Number
}, { timestamps: true });

export default mongoose.model("Download", schema);