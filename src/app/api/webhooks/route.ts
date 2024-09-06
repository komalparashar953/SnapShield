import { db } from '@/db'
import { stripe } from '@/lib/stripe'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import OrderReceivedEmail from '@/components/emails/OrderReceivedEmail'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: Request) {
  try {
    const body = await req.text()
    const signature = headers().get('stripe-signature')

    if (!signature) {
      return new Response('Invalid signature', { status: 400 })
    }

    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )

    // Log the entire event object for debugging purposes
    console.log('Stripe event:', event)

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

      // Log the session object to ensure metadata exists
      console.log('Checkout session:', session)

      if (!session.customer_details?.email) {
        throw new Error('Missing customer email')
      }

      const { userId, orderId } = session.metadata || {
        userId: null,
        orderId: null,
      }

      // Ensure userId and orderId exist
      if (!userId || !orderId) {
        console.error('Missing userId or orderId in session metadata')
        throw new Error('Invalid request metadata')
      }

      // Log metadata
      console.log('Metadata:', { userId, orderId })

      const billingAddress = session.customer_details?.address
      const shippingAddress = session.shipping_details?.address

      // Log billing and shipping addresses for debugging
      console.log('Billing Address:', billingAddress)
      console.log('Shipping Address:', shippingAddress)

      // Check if billing and shipping addresses are present
      if (!billingAddress || !shippingAddress) {
        console.error('Missing billing or shipping address')
        throw new Error('Missing address information')
      }

      const updatedOrder = await db.order.update({
        where: {
          id: orderId,
        },
        data: {
          isPaid: true,
          shippingAddress: {
            create: {
              name: session.customer_details.name! || 'Unknown', // Fallback to 'Unknown'
              city: shippingAddress?.city || 'Unknown',
              country: shippingAddress?.country || 'Unknown',
              postalCode: shippingAddress?.postal_code || 'Unknown',
              street: shippingAddress?.line1 || 'Unknown',
              state: shippingAddress?.state || null, // Optional
            },
          },
          billingAddress: {
            create: {
              name: session.customer_details.name || 'Unknown', // Fallback to 'Unknown'
              city: billingAddress?.city || 'Unknown',
              country: billingAddress?.country || 'Unknown',
              postalCode: billingAddress?.postal_code || 'Unknown',
              street: billingAddress?.line1 || 'Unknown',
              state: billingAddress?.state || null, // Optional
            },
          },
        },
      })

      // Log updated order
      console.log('Updated Order:', updatedOrder)

      // Send confirmation email
      await resend.emails.send({
        from: 'SnapShield <komalpc1001@gmail.com>',
        to: [session.customer_details.email],
        subject: 'Thanks for your order!',
        react: OrderReceivedEmail({
          orderId,
          orderDate: updatedOrder.createdAt.toLocaleDateString(),
          //@ts-ignore
          shippingAddress: {
            name: session.customer_details!.name!,
            city: shippingAddress!.city!,
            country: shippingAddress!.country!,
            postalCode: shippingAddress!.postal_code!,
            street: shippingAddress!.line1!,
            state: shippingAddress!.state,
          },
        }),
      })
    }

    return NextResponse.json({ result: event, ok: true })
  } catch (err) {
    console.error('Error processing webhook:', err)
    return NextResponse.json(
      { message: 'Something went wrong', ok: false },
      { status: 500 }
    )
  }
}

