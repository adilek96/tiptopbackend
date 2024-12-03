
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

const step2 = createStep("step-2", async (data:any) => {
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const messageForMe = `🌟*Пользователь оформил заказ*🌟

**ID заказа:** *${data.data.result.id}*
**Имя клиента:** *${data.data.result.shipping_methods[0].data.consumerName} ${data.data.result.shipping_methods[0].data.consumerLastName}*
${data.data.result.shipping_methods[0].shipping_option_id !== "so_01JCKDY5CCK7FZ47AXVY1GQ7AF" ? `**Дата и время доставки:** *${data.data.result.shipping_methods[0].data.deliveryDate}, ${data.data.result.shipping_methods[0].data.deliveryTime}*` : ""}
**Телефон клиента:** *${data.data.result.shipping_methods[0].data.consumerPhone}*
**Метод доставки:** *${data.data.result.shipping_methods[0].name}*
${data.data.result.shipping_methods[0].shipping_option_id === "so_01JCKDR1NYHC7BEC8P104PBH7Z" ? `**Станция метро:** *${data.data.result.shipping_methods[0].data.metroStation}*` : ""}
${data.data.result.shipping_methods[0].shipping_option_id === "so_01JCKDSGCDMWBBZQWQ2VQ7NNY2" ? `**Адрес доставки:** *${data.data.result.shipping_methods[0].data.address}*` : ""}
${data.data.result.shipping_methods[0].shipping_option_id === "so_01JCKDY5CCK7FZ47AXVY1GQ7AF" ? `**Город:** *${data.data.result.shipping_methods[0].data.city}*\n**Адрес доставки:** *${data.data.result.shipping_methods[0].data.address}*` : ""}`;

    

    
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
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
        .then(data => console.log("Сообщение отправлено:"))
        .catch(error => console.error("Ошибка:", error));
  

 
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
  