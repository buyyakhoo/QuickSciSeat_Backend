import { Hono } from 'hono'
import { prisma } from '../shared/database/prisma.js';

const app = new Hono()

// Create a new reservation
app.post('/reservation', async (c) => {
    try {
        const body = await c.req.json();
        const { user_id, timeslot_id, party_size, table_ids, student_ids } = body;

        const user_idNew : number = parseInt(user_id);

        // Validation
        if (!user_id || !timeslot_id || !party_size || !table_ids || table_ids.length === 0) {
            return c.json({
                success: false,
                error: 'Missing required fields: user_id, timeslot_id, party_size, table_ids'
            }, 400);
        }

        // Validate party_size
        if (party_size < 1) {
            return c.json({
                success: false,
                error: 'party_size must be at least 1'
            }, 400);
        }

        // ตรวจสอบว่า user นี้มีการจองที่ active อยู่หรือไม่ (ทุก timeslot)
        const existingActiveReservation = await prisma.reservation.findFirst({
            where: {
                user_id: user_idNew,
                status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] } // ไม่สนใจ timeslot_id
            },
            include: {
                timeslot: {
                    select: {
                        slot_id: true,
                        start_at: true,
                        end_at: true
                    }
                }
            }
        });

        if (existingActiveReservation) {
            return c.json({
                success: false,
                error: 'You already have an active reservation',
                error_th: `คุณมีการจองอยู่แล้ว (${existingActiveReservation.timeslot.slot_id})`,
                existing_reservation_id: existingActiveReservation.reservation_id,
                existing_timeslot: existingActiveReservation.timeslot.slot_id
            }, 409); // 409 Conflict
        }

        // Double-check: ตรวจสอบว่าโต๊ะว่างจริงหรือไม่
        const reservedTables = await prisma.reservationtable.findMany({
            where: {
                timeslot_id,
                table_id: { in: table_ids },
                reservation: {
                    status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] } // ไม่รวม CHECKED_OUT, CANCELLED, AUTO_CANCELLED, EXPIRED
                }
            }
        });

        if (reservedTables.length > 0) {
            return c.json({
                success: false,
                error: 'One or more tables are already reserved for this timeslot'
            }, 409); // 409 Conflict
        }

        // Create reservation with transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Reservation record
            const reservation = await tx.reservation.create({
                data: {
                    user_id: user_idNew,
                    timeslot_id,
                    party_size,
                    status: 'PENDING'
                }
            });

            // 2. Create ReservationTable entries (link reservation to tables)
            const reservationTables = await Promise.all(
                table_ids.map((table_id: number) =>
                    tx.reservationtable.create({
                        data: {
                            reservation_id: reservation.reservation_id,
                            table_id,
                            timeslot_id
                        }
                    })
                )
            );

            // 3. (Optional) Update TableTimeslotStatus to 'reserved'
            // ถ้าคุณต้องการ sync status ระหว่าง Reservation กับ TableTimeslotStatus
            await Promise.all(
                table_ids.map((table_id: number) =>
                    tx.tabletimeslotstatus.updateMany({
                        where: {
                            table_id,
                            timeslot_id
                        },
                        data: {
                            status: 'reserved'
                        }
                    })
                )
            );

            return { reservation, reservationTables };
        });

        console.log('Reservation created:', result.reservation.reservation_id);
        console.log('Student IDs:', student_ids); // Log student_ids (ถ้าต้องการเก็บต้องสร้าง table แยก)

        return c.json({
            success: true,
            reservation_id: result.reservation.reservation_id,
            message: 'Reservation created successfully'
        }, 201);

    } catch (error) {
        console.error('Error creating reservation:', error);
        return c.json({
            success: false,
            error: 'Failed to create reservation',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});

app.get('/check/:user_id/reservation', async (c) => {
    const user_id = parseInt(c.req.param("user_id"));

    const reservations = await prisma.reservation.findFirst({
        where: {
            user_id: user_id
        },
        include: {
            reservationtable: {
                include: {
                    timeslot: {
                        select: {
                            slot_id: true
                        }
                    }
                }
            }
        }
    });

    if (!reservations) {
        return c.json({
            success: true,
            status: false,
            message: 'No reservation found for this user'
        }, 200);
    }

    return c.json({
        success: true,
        status: true,
        tableReservation: reservations
    }, 200);
})

export { app as reservation_service }