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

app.get('/timeslot/:slot_id/tables', async (c) => {
    const slot_id = c.req.param('slot_id');

    if (slot_id === 'all') {
        const data = await prisma.tabletimeslotstatus.findMany({
            select: {
                status: true,
                Table: {
                    select: {
                        table_id: true,
                        table_code: true,
                        capacity: true,
                        min_capacity: true,
                        is_active: true
                    }
                },
                timeslot: {
                    select: {
                        slot_id: true,
                        start_at: true,
                        end_at: true
                    }
                }
            },
            where: {
                Table: {
                    is_active: true
                }
            }
        });

        // flatten ให้ consumer frontend ง่าย + เพิ่ม slot_id
        const result = data.map(ttss => ({
            table_id: ttss.Table.table_id,
            table_code: ttss.Table.table_code,
            capacity: ttss.Table.capacity,
            min_capacity: ttss.Table.min_capacity,
            status: ttss.status,
            slot_id: ttss.timeslot.slot_id  // ✅ เพิ่ม slot_id
        }));

        return c.json(result);
    }

    const timeslot_id = await prisma.timeslot.findUnique({
        where: { slot_id },
        select: { timeslot_id: true }
    }).then(ts => ts?.timeslot_id);

    console.log('timeslot_id--------------------:', timeslot_id);

    const data = await prisma.tabletimeslotstatus.findMany({
        where: {
            timeslot: { timeslot_id }
        },
        select: {
            status: true,
            Table: {
                select: {
                    table_id: true,
                    table_code: true,
                    capacity: true,
                    min_capacity: true,
                    is_active: true
                }
            }
        }
    })

    // flatten ให้ consumer frontend ง่าย
    const result = data.map(ttss => ({
        table_id: ttss.Table.table_id,
        table_code: ttss.Table.table_code,
        capacity: ttss.Table.capacity,
        min_capacity:  ttss.Table.min_capacity, 
        status: ttss.status
    }));

    return c.json(result);
    
})

app.get('/timeslot/:slot_id/table/:table_id', async (c) => {
    const slot_id = c.req.param('slot_id');

    const ts = await prisma.timeslot.findUnique({
        where: { slot_id },
        select: { timeslot_id: true }
    });
    
    const timeslot_id = ts?.timeslot_id;
    const table_id = parseInt(c.req.param('table_id'));

    const data = await prisma.tabletimeslotstatus.findFirst({
        where: {
            timeslot: { timeslot_id },
            table_id
        },
        select: {
            status: true,
            Table: {
                select: {
                    table_id: true,
                    table_code: true,
                    capacity: true,
                    min_capacity: true,
                    is_active: true
                }
            },
            timeslot: {
                select: {
                    timeslot_id: true,
                    slot_id: true,
                    start_at: true,
                    end_at: true
                }
            }
        }
    });

    return c.json(data);
    
})


export { app as tableService }
