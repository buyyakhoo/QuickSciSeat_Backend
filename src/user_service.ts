import { Hono } from 'hono'
import { cors } from 'hono/cors';
import { prisma } from './shared/database/prisma.js';

const app = new Hono()

app.get('/', (c) => {
    return c.json({ 
        message: 'User Service is running',
        endpoints: {
            verifyOrCreate: 'POST /verify-or-create'
        }
    })
})

app.post('/verify-or-create', async (c) => {
    try {
        const body = await c.req.json()
        
        console.log('\n' + '='.repeat(60))
        console.log('Received OAuth Data from Frontend:')
        console.log('='.repeat(60))
        console.log('Email:', body.email)
        console.log('Name:', body.name)
        console.log('User ID:', body.user_id)
        console.log('Google ID:', body.googleId)
        console.log('Image:', body.image)
        console.log('Full Body:', JSON.stringify(body, null, 2))
        console.log('='.repeat(60) + '\n')

        // UPSERT: INSERT if not exists, UPDATE if exists
        const user = await prisma.users.upsert({
            where: {
                user_id: body.user_id
            },
            update: {
                // nothing update
            },
            create: {
                user_id: body.user_id,
                email: body.email,
                name: body.name,
                user_type: 'student' // Default
            }
        });
        
        return c.json({
            success: true,
            message: 'Data received successfully!',
            received_data: body
        }, 200)
        
    } catch (error) {
        console.error('Error:', error)
        return c.json({
            success: false,
            error: 'Failed to process request'
        }, 500)
    }
})

app.get('/user/:student_id', async (c) => {
    const student_id = c.req.param('student_id')
    console.log(`Fetching user with ID: ${student_id}`)
    const user = await prisma.users.findUnique({
        where: { user_id: student_id }
    })

    if (!user) {
        return c.json({ error: 'User not found', success: false }, 404)
    }
    return c.json({ ...user, success: true }, 200)
})


export { app as userService }