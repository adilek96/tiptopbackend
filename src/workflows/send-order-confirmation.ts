
import { container } from "@medusajs/framework"
import {
    createStep,
    StepResponse,
    createWorkflow,
    WorkflowResponse,
  } from "@medusajs/framework/workflows-sdk"
 import {getOrderDetailWorkflow} from "@medusajs/medusa/core-flows"

  


  interface OrderConfirmationInput {
    id: string
}
 
//   создаем шаг первый. тут будет происходить поиск заказа по его айди

const step1 = createStep(
  "step-1", 
  async (input: OrderConfirmationInput) => {
    const order = await getOrderDetailWorkflow(container).run({
    input:{
        order_id: input.id,
        fields: [
          "shipping_methods",
        ]
    }
      })
      

    return new StepResponse({    
      data: order, // Передаем данные заказа в следующий шаг
    });
  })

//   -------------------------------------------------------------------

//    создаем шаг второй. тут будет происходить отправка уведомления в  телеграм

// Идентификаторы способов доставки берутся из окружения: при пересоздании
// базы Medusa выдаёт новые, и зашивать их в код нельзя. Значения печатает
// сид-скрипт (src/scripts/seed.ts).
const METRO_OPTION_ID = process.env.SHIPPING_OPTION_METRO_ID;
const CITY_OPTION_ID = process.env.SHIPPING_OPTION_CITY_ID;
const COUNTRY_OPTION_ID = process.env.SHIPPING_OPTION_COUNTRY_ID;

const step2 = createStep("step-2", async (data:any) => {

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const shipping = data.data.result.shipping_methods[0];
    const optionId = shipping.shipping_option_id;
    const messageForMe = `🌟*Пользователь оформил заказ*🌟

**ID заказа:** *${data.data.result.id}*
**Имя клиента:** *${shipping.data.consumerName} ${shipping.data.consumerLastName}*
${optionId !== COUNTRY_OPTION_ID ? `**Дата и время доставки:** *${shipping.data.deliveryDate}, ${shipping.data.deliveryTime}*` : ""}
**Телефон клиента:** *${shipping.data.consumerPhone}*
**Метод доставки:** *${shipping.name}*
${optionId === METRO_OPTION_ID ? `**Станция метро:** *${shipping.data.metroStation}*` : ""}
${optionId === CITY_OPTION_ID ? `**Адрес доставки:** *${shipping.data.address}*` : ""}
${optionId === COUNTRY_OPTION_ID ? `**Город:** *${shipping.data.city}*\n**Адрес доставки:** *${shipping.data.address}*` : ""}`;




      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageForMe,
          parse_mode: "Markdown",
        }),
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.json();
        })
        .then(() => console.log("Уведомление о заказе отправлено в Telegram"))
        // Заказ не должен падать из-за недоступности Telegram — только лог.
        .catch(error => console.error("Не удалось отправить уведомление:", error));
  

 
})


// ---------------------------------------------------------------------



// ---------------------------------------------------------------------


  const sendOrderConfirmationWorkflow = createWorkflow(
    "send-order-confirmation",
     function  (input: OrderConfirmationInput) {

        const str1 = step1(input)

        const str2 = step2(str1)
  
      return new WorkflowResponse({
        message: "isSent",
      })
    }
  );
  
  export default sendOrderConfirmationWorkflow;
  