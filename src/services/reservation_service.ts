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

            // 2. 🔥 ลบ ReservationTable เก่าที่มี (table_id, timeslot_id) ซ้ำก่อน (FIX UNIQUE CONSTRAINT ERROR)
            await Promise.all(
                table_ids.map((table_id: number) =>
                    tx.reservationtable.deleteMany({
                        where: {
                            table_id,
                            timeslot_id
                        }
                    })
                )
            );

            // 3. สร้าง ReservationTable entries ใหม่
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

            // 4. Sync status ระหว่าง Reservation กับ TableTimeslotStatus
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

    if (reservations.status === 'CANCELLED' || reservations.status === 'AUTO_CANCELLED' || reservations.status === 'EXPIRED' || reservations.status === 'CHECKED_OUT') {
        return c.json({
            success: true,
            status: false,
            message: 'No active reservation found for this user'
        }, 200);
    }

    return c.json({
        success: true,
        status: true,
        tableReservation: reservations
    }, 200);
})

// app.post('/reservation/checkin', async (c) => {

//     // insert check-in data to checkin table

//     // update reservation status to CHECKED_IN

//     // update tabletimeslotstatus to occupied

// })

app.post('/reservation/checkin', async (c) => {
    try {
        const body = await c.req.json();
        const { reservation_id, user_id } = body;

        // Validation
        if (!reservation_id) {
            return c.json({
                success: false,
                error: 'Missing required field: reservation_id',
                error_th: 'กรุณาระบุหมายเลขการจอง'
            }, 400);
        }

        // 1. ตรวจสอบว่า reservation มีอยู่จริงและเป็นของ user นี้
        const reservation = await prisma.reservation.findUnique({
            where: { reservation_id: parseInt(reservation_id) },
            include: {
                reservationtable: {
                    include: {
                        Table: true
                    }
                },
                timeslot: true
            }
        });

        if (!reservation) {
            return c.json({
                success: false,
                error: 'Reservation not found',
                error_th: 'ไม่พบการจอง'
            }, 404);
        }

        // 2. เช็คว่าเป็นของ user นี้จริง (ถ้าส่ง user_id มา)
        if (user_id && reservation.user_id !== parseInt(user_id)) {
            return c.json({
                success: false,
                error: 'This reservation does not belong to you',
                error_th: 'นี่ไม่ใช่การจองของคุณ'
            }, 403);
        }

        // 3. เช็คสถานะ reservation
        if (reservation.status === 'CHECKED_IN') {
            return c.json({
                success: false,
                error: 'Already checked in',
                error_th: 'Check-in แล้ว'
            }, 409);
        }

        if (reservation.status === 'CHECKED_OUT') {
            return c.json({
                success: false,
                error: 'Already checked out',
                error_th: 'Check-out แล้ว'
            }, 409);
        }

        if (reservation.status === 'CANCELLED' || reservation.status === 'AUTO_CANCELLED' || reservation.status === 'EXPIRED') {
            return c.json({
                success: false,
                error: 'Reservation is cancelled or expired',
                error_th: 'การจองถูกยกเลิกหรือหมดอายุแล้ว'
            }, 409);
        }

        // 4. ทำ Check-in ด้วย transaction
        const result = await prisma.$transaction(async (tx) => {
            // 4.1 Insert check-in record (ใช้ checkin_time ตาม schema)
            const checkin = await tx.checkin.create({
                data: {
                    reservation_id: reservation.reservation_id,
                    checkin_time: new Date()
                }
            });

            // 4.2 Update reservation status to CHECKED_IN
            const updatedReservation = await tx.reservation.update({
                where: { reservation_id: reservation.reservation_id },
                data: {
                    status: 'CHECKED_IN',
                    updated_at: new Date()
                }
            });

            // 4.3 Update TableTimeslotStatus to 'occupied' for all tables in this reservation
            const tableIds = reservation.reservationtable.map(rt => rt.table_id);
            await Promise.all(
                tableIds.map((table_id) =>
                    tx.tabletimeslotstatus.updateMany({
                        where: {
                            table_id,
                            timeslot_id: reservation.timeslot_id
                        },
                        data: {
                            status: 'occupied'
                        }
                    })
                )
            );

            return { checkin, updatedReservation };
        });

        console.log('Check-in successful:', result.checkin.checkin_id);

        return c.json({
            success: true,
            message: 'Check-in successful',
            message_th: 'Check-in สำเร็จ',
            checkin_id: result.checkin.checkin_id,
            reservation_id: reservation.reservation_id,
            checkin_time: result.checkin.checkin_time
        }, 200);

    } catch (error) {
        console.error('Error during check-in:', error);
        return c.json({
            success: false,
            error: 'Failed to check-in',
            error_th: 'Check-in ไม่สำเร็จ',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});

// Check-out
app.post('/reservation/checkout', async (c) => {
    try {
        const body = await c.req.json();
        const { reservation_id, user_id } = body;

        // Validation
        if (!reservation_id) {
            return c.json({
                success: false,
                error: 'Missing required field: reservation_id',
                error_th: 'กรุณาระบุหมายเลขการจอง'
            }, 400);
        }

        // 1. ตรวจสอบว่า reservation มีอยู่จริงและเป็นของ user นี้
        const reservation = await prisma.reservation.findUnique({
            where: { reservation_id: parseInt(reservation_id) },
            include: {
                reservationtable: {
                    include: {
                        Table: true
                    }
                },
                timeslot: true,
                checkin: true  // เช็คว่ามี check-in record หรือไม่
            }
        });

        if (!reservation) {
            return c.json({
                success: false,
                error: 'Reservation not found',
                error_th: 'ไม่พบการจอง'
            }, 404);
        }

        // 2. เช็คว่าเป็นของ user นี้จริง
        if (user_id && reservation.user_id !== parseInt(user_id)) {
            return c.json({
                success: false,
                error: 'This reservation does not belong to you',
                error_th: 'นี่ไม่ใช่การจองของคุณ'
            }, 403);
        }

        // 3. เช็คสถานะ reservation
        if (reservation.status !== 'CHECKED_IN') {
            return c.json({
                success: false,
                error: `Cannot checkout. Current status: ${reservation.status}`,
                error_th: `ไม่สามารถ check-out ได้ สถานะปัจจุบัน: ${reservation.status}`,
                current_status: reservation.status
            }, 409);
        }

        // 4. ทำ Check-out ด้วย transaction
        const result = await prisma.$transaction(async (tx) => {
            // 4.1 Update checkin record with checkout_time
            // (ถ้า schema มี checkout_time field ใน CheckIn table)
            // หรือสร้าง CheckOut table แยก
            
            // 4.2 Update reservation status to CHECKED_OUT
            const updatedReservation = await tx.reservation.update({
                where: { reservation_id: reservation.reservation_id },
                data: {
                    status: 'CHECKED_OUT',
                    updated_at: new Date()
                }
            });

            // 4.3 Update TableTimeslotStatus to 'available'
            const tableIds = reservation.reservationtable.map(rt => rt.table_id);
            await Promise.all(
                tableIds.map((table_id) =>
                    tx.tabletimeslotstatus.updateMany({
                        where: {
                            table_id,
                            timeslot_id: reservation.timeslot_id
                        },
                        data: {
                            status: 'available'
                        }
                    })
                )
            );

            return { updatedReservation };
        });

        console.log('Check-out successful for reservation:', reservation.reservation_id);

        return c.json({
            success: true,
            message: 'Check-out successful',
            message_th: 'Check-out สำเร็จ',
            reservation_id: reservation.reservation_id,
            checkout_time: new Date()
        }, 200);

    } catch (error) {
        console.error('Error during check-out:', error);
        return c.json({
            success: false,
            error: 'Failed to check-out',
            error_th: 'Check-out ไม่สำเร็จ',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});

export { app as reservation_service }