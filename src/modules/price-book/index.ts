import { Module } from "@medusajs/framework/utils"
import PriceBookService from "./service"

export const PRICE_BOOK_MODULE = "priceBookService"

export default Module(PRICE_BOOK_MODULE, {
  service: PriceBookService,
})
