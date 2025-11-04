import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { userService } from './services/user_service.js'
import { tableService } from './services/table_service.js'
// import { seat_controller } from './controllers/seat_controller.js'

const app = new Hono()

// Enable CORS for all routes
app.use('/*', cors({
  origin: '*',
  credentials: true,
}))


app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route('/user_service', userService)
app.route('/table_service', tableService)

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
