import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Таблицы прайс-книги.
 *
 * Написана руками, а не сгенерирована `medusa db:generate`: генератору
 * нужна живая база, а её под рукой не было. Схема повторяет то, что
 * генератор делает для model.define — включая numeric + raw_ jsonb под
 * bigNumber и частичные индексы с `where deleted_at is null`.
 */
export class Migration20260830000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "cost_price" ("id" text not null, "variant_id" text not null, "amount" numeric not null, "raw_amount" jsonb not null, "currency_code" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cost_price_pkey" primary key ("id"));`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_price_deleted_at" ON "cost_price" (deleted_at) WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cost_price_variant_id_unique" ON "cost_price" (variant_id) WHERE deleted_at IS NULL;`)

    this.addSql(`create table if not exists "discount_price" ("id" text not null, "price_list_id" text not null, "variant_id" text not null, "amount" numeric not null, "raw_amount" jsonb not null, "currency_code" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "discount_price_pkey" primary key ("id"));`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discount_price_deleted_at" ON "discount_price" (deleted_at) WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discount_price_price_list_id" ON "discount_price" (price_list_id) WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_discount_price_price_list_id_variant_id_unique" ON "discount_price" (price_list_id, variant_id) WHERE deleted_at IS NULL;`)

    this.addSql(`create table if not exists "discount_opt_in" ("id" text not null, "product_id" text not null, "enabled" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "discount_opt_in_pkey" primary key ("id"));`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_discount_opt_in_deleted_at" ON "discount_opt_in" (deleted_at) WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_discount_opt_in_product_id_unique" ON "discount_opt_in" (product_id) WHERE deleted_at IS NULL;`)
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "cost_price" cascade;`)
    this.addSql(`drop table if exists "discount_price" cascade;`)
    this.addSql(`drop table if exists "discount_opt_in" cascade;`)
  }
}
