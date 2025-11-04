import { Hono } from 'hono'
import { prisma } from '../shared/database/prisma.js';

const app = new Hono()

app.get('/tables', async (c) => {
    const tables = await prisma.table.findMany({
        include: {
            floor: true
        }
    });

    if (!tables) {
        return c.json({
            success: false,
            error: 'No tables found'
        }, 404);
    }

    // const tablesResult = tables.map(t => {
    // return {
    //     ...t,
    //     floor: {
    //     ...t.floor,
    //     open_time: t.floor.open_time.toTimeString().slice(0,5),
    //     close_time: t.floor.close_time.toTimeString().slice(0,5)
    //     }
    // }
    // });

    return c.json({
        success: true,
        tables: tables
    }, 200);
})

app.get('/table/:table_id', async (c) => {
    const table_id = c.req.param('table_id');
    const table = await prisma.table.findUnique({
        where: { table_id: parseInt(table_id) },
        include: {
            floor: true
        }
    });
    if (!table) {
        return c.json({
        success: false,
        error: 'Table not found'
        }, 404);
    }
    // const tableResult = {
    //     ...table,
    //     floor: {
    //         ...table.floor,
    //         open_time: table.floor.open_time.toTimeString().slice(0,5),
    //         close_time: table.floor.close_time.toTimeString().slice(0,5)
    //     }
    // };
    return c.json({
        success: true,
        table: table
    }, 200);
})

app.get('/floor/:floor_id/tables', async (c) => {
    const floor_id = c.req.param('floor_id');
    const tables = await prisma.table.findMany({
        where: { floor_id: parseInt(floor_id) },
        include: {
            floor: true
        }
    });
    if (!tables) {
        return c.json({
            success: false,
            error: 'No tables found for this floor'
        }, 404);
    }
    // const tablesResult = tables.map(t => {
    //     return {
    //         ...t,
    //         floor: {
    //             ...t.floor,
    //             open_time: t.floor.open_time.toTimeString().slice(0,5),
    //             close_time: t.floor.close_time.toTimeString().slice(0,5)
    //         }
    //     }
    // });
    return c.json({
        success: true,
        tables: tables
    }, 200);
})

app.get('/timeslots', async (c) => {
    const timeslots = await prisma.timeslot.findMany();
    if (!timeslots) {
        return c.json({
            success: false,
            error: 'No timeslots found'
        }, 404);
    }

    const timeslotsResult = timeslots.map(ts => {
        const s = new Date(ts.start_at);
        s.setHours(s.getHours() - 7);

        const e = new Date(ts.end_at);
        e.setHours(e.getHours() - 7);

        return {
            ...ts,
            start_at: s.toTimeString().slice(0, 5),
            end_at: e.toTimeString().slice(0, 5)
        }
    });

    //     ({
    //     ...ts,
    //     start_at: ts.start_at.toTimeString().slice(0,5),
    //     end_at: ts.end_at.toTimeString().slice(0,5)
    // }));

    console.log(timeslotsResult);

    return c.json({
        success: true,
        timeslots: timeslotsResult
    }, 200);
})

app.get('/timeslot/:timeslot_id', async (c) => {
    const timeslot_id = c.req.param('timeslot_id');
    const timeslot = await prisma.timeslot.findUnique({
        where: { timeslot_id: parseInt(timeslot_id) }
    });
    if (!timeslot) {
        return c.json({
            success: false,
            error: 'Timeslot not found'
        }, 404);
    }
    const timeslotResult = {
        ...timeslot,
        start_at: timeslot.start_at.toTimeString().slice(0,5),
        end_at: timeslot.end_at.toTimeString().slice(0,5)
    };
    return c.json({
        success: true,
        timeslot: timeslotResult
    }, 200);
})

app.get('/timeslot/:timeslot_id/tables', async (c) => {
    const timeslot_id = parseInt(c.req.param('timeslot_id'));

    const data = await prisma.table.findMany({
        where: {
            is_active: true
        },
            orderBy: {
            table_id: 'asc'
        },
        select: {
            table_id: true,
            table_code: true,
            capacity: true,
            min_capacity: true,
            tabletimeslotstatus: {
                where: { timeslot_id },
                select: {
                    status: true
                }
            }
        }
    });

    // flatten ให้ consumer frontend ง่าย
    const result = data.map(t => ({
        table_id: t.table_id,
        table_code: t.table_code,
        capacity: t.capacity,
        min_capacity: t.min_capacity,
        status: t.tabletimeslotstatus[0].status
    }));

    return c.json(result);
    
})


export { app as tableService }
