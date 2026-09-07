import { startSellerServer } from "../src/seller/server.js";
import { config } from "../src/config.js";

startSellerServer(config.seller.port);
