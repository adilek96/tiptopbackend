import { Module } from "@medusajs/framework/utils"
import ProductImportService from "./service"

export const PRODUCT_IMPORT_MODULE = "productImportService"

export default Module(PRODUCT_IMPORT_MODULE, {
  service: ProductImportService,
})
