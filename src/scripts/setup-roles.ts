import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const CASHIER_ROLE_NAME = "Кассир"
const CASHIER_POLICY_KEYS = ["pos:read", "pos:create"]

/** Роль полного доступа. Её создаёт сам модуль ролей при первом старте. */
const SUPER_ADMIN_ROLE_ID = "role_super_admin"

/**
 * Раздача ролей после включения RBAC.
 *
 * Включённый флаг rbac меняет поведение всей админки разом: маршруты ядра
 * начинают требовать политику, а пользователь без единой роли получает
 * Forbidden. Поэтому скрипт нужно прогнать сразу после первого деплоя с
 * флагом — иначе продавец увидит пустую админку с ошибками доступа.
 *
 * Что делает:
 *   1. Выдаёт всем пользователям без ролей роль полного доступа. Это спасает
 *      действующих админов: до включения флага ролей не было ни у кого.
 *   2. Создаёт роль «Кассир» с правами только на кассу.
 *
 * Скрипт идемпотентен: повторный запуск ничего не дублирует.
 *
 * Роли попадают в токен в момент входа, а не при каждом запросе. Поэтому
 * тот, кому роль выдали или сняли, увидит изменения только после
 * перезахода — это относится и к кассиру, и к админу.
 *
 *   npx medusa exec ./src/scripts/setup-roles.ts
 */
export default async function setupRoles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const rbacModuleService: any = container.resolve(Modules.RBAC)

  // --- 1. Никто не должен остаться без роли --------------------------------

  const { data: users } = await query.graph({
    entity: "user",
    fields: ["id", "email", "rbac_roles.id"],
  })

  const withoutRoles = users.filter((user: any) => !(user.rbac_roles ?? []).length)

  if (withoutRoles.length) {
    // Назначаем связь напрямую, а не рабочим процессом assignUserRoles: тот
    // проверяет, что назначающий сам обладает выдаваемыми правами, а у
    // скрипта нет действующего пользователя — и на старте прав нет ни у кого.
    await link.create(
      withoutRoles.map((user: any) => ({
        user: { user_id: user.id },
        rbac: { rbac_role_id: SUPER_ADMIN_ROLE_ID },
      }))
    )

    logger.info(
      `Полный доступ выдан ${withoutRoles.length} пользователю(ям): ` +
        withoutRoles.map((user: any) => user.email).join(", ")
    )
  } else {
    logger.info("Пользователей без ролей нет — полный доступ никому не понадобился")
  }

  // --- 2. Роль кассира ------------------------------------------------------

  // Политики создаёт модуль ролей при старте по каталогу из src/policies.
  // Если их нет, значит каталог не загрузился — молча создавать политики
  // руками нельзя: следующий рестарт их удалит.
  const policies = await rbacModuleService.listRbacPolicies({
    key: CASHIER_POLICY_KEYS,
  })

  const foundKeys = policies.map((policy: any) => policy.key)
  const missingKeys = CASHIER_POLICY_KEYS.filter((key) => !foundKeys.includes(key))

  if (missingKeys.length) {
    logger.error(
      `Не найдены политики кассы: ${missingKeys.join(", ")}. ` +
        "Проверьте, что файл src/policies/pos.ts попал в сборку, и перезапустите бэкенд."
    )
    return
  }

  const [existingRole] = await rbacModuleService.listRbacRoles({
    name: CASHIER_ROLE_NAME,
  })

  const role =
    existingRole ??
    (await rbacModuleService.createRbacRoles({
      name: CASHIER_ROLE_NAME,
      description: "Доступ только к кассе: поиск товара, остатки и продажа",
    }))

  const attached = await rbacModuleService.listPoliciesForRole(role.id)
  const attachedIds = attached.map((policy: any) => policy.id)

  const toAttach = policies
    .filter((policy: any) => !attachedIds.includes(policy.id))
    .map((policy: any) => ({ role_id: role.id, policy_id: policy.id }))

  if (toAttach.length) {
    await rbacModuleService.createRbacRolePolicies(toAttach)
  }

  logger.info(
    existingRole
      ? `Роль «${CASHIER_ROLE_NAME}» уже была, прав добавлено: ${toAttach.length}`
      : `Создана роль «${CASHIER_ROLE_NAME}» с правами: ${CASHIER_POLICY_KEYS.join(", ")}`
  )

  logger.info(
    "Готово. Кассира заводите обычным пользователем в админке, затем выдайте ему " +
      `роль «${CASHIER_ROLE_NAME}» в разделе Settings → Roles. Касса открывается по адресу /pos.`
  )
}
