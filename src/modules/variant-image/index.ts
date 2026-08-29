import VariantImageService from "./service"
import { Module } from "@medusajs/framework/utils"

export const VARIANT_IMAGE_MODULE = "variantImageService"

export default Module(VARIANT_IMAGE_MODULE, {
  service: VariantImageService,
})

