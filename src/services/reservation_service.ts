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

// เช็คว่าผู้ใช้มีการจองโต๊ะใน timeslot นั้นหรือไม่
app.get('/check/:user_id/:table_id/:slot_id/reservation', async (c) => {
    const user_id = parseInt(c.req.param("user_id"));
    const table_id = parseInt(c.req.param("table_id"));
    const slot_id = c.req.param("slot_id");

    // หาการจองของ user นี้ที่ตรงกับ table_id และ slot_id
    const reservations = await prisma.reservation.findFirst({
        where: {
            user_id: user_id,
            reservationtable: {
                some: {
                    table_id: table_id,
                    timeslot: {
                        slot_id: slot_id
                    }
                }
            }
        },
        include: {
            timeslot: true,
            reservationtable: {
                include: {
                    Table: true,
                    timeslot: true
                }
            }
        }
    });

    if (!reservations) {
        return c.json({
            success: true,
            status: false,
            message: 'No reservation found for this user with the specified table and timeslot'
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
});

app.get('/check/:user_id/reservation', async (c) => {
    const user_id = parseInt(c.req.param("user_id"));

    const reservations = await prisma.reservation.findFirst({
        where: {
            user_id: user_id,
            status: {
                in: ['PENDING', 'CONFIRMED', 'CHECKED_IN']
            }
        },
        include: {
            timeslot: true,
            reservationtable: {
                include: {
                    Table: true,
                    timeslot: true
                }
            }
        },
        orderBy: {
            created_at: 'desc'
        }
    });

    // ถ้าไม่เจอ = user ไม่มีการจอง active
    if (!reservations) {
        return c.json({
            success: true,
            status: false,
            message: 'No active reservation found for this user'
        }, 200);
    }

    // ไม่ต้อง check status อีกครั้ง เพราะ where clause กรองให้แล้ว
    return c.json({
        success: true,
        status: true,
        tableReservation: reservations
    }, 200);
});

// app.get('/reservation/:reservation_id', async (c) => {
//     const reservation_id = parseInt(c.req.param("reservation_id"));
//     const reservation = await prisma.reservationtable.findFirst({
//         where: {
//             reservation_id: reservation_id
//         },
//         include: {
//             Table: true,
//             timeslot: true
//         }
//     });
//     if (!reservation) {
//         return c.json({
//             success: false,
//             error: 'Reservation not found'
//         }, 404);
//     }
//     return c.json({
//         success: true,
//         reservation: reservation
//     }, 200);
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

// Get reservation history
app.get('/user/:user_id/reservations/history', async (c) => {
    try {
        const user_id = parseInt(c.req.param("user_id"));

        if (!user_id) {
            return c.json({
                success: false,
                error: 'Invalid user_id'
            }, 400);
        }

        // ดึงประวัติการจองทั้งหมดที่ไม่ใช่ active reservation
        const reservations = await prisma.reservation.findMany({
            where: {
                user_id: user_id,
                status: {
                    in: ['CHECKED_OUT', 'CANCELLED', 'AUTO_CANCELLED', 'EXPIRED']
                }
            },
            include: {
                reservationtable: {
                    include: {
                        Table: true  // ดึงข้อมูลโต๊ะทั้งหมด
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
            orderBy: {
                created_at: 'desc' // เรียงจากล่าสุดไปเก่าสุด
            }
        });

        return c.json({
            success: true,
            reservations: reservations,
            count: reservations.length
        }, 200);

    } catch (error) {
        console.error('Error fetching reservation history:', error);
        return c.json({
            success: false,
            error: 'Failed to fetch reservation history',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});

// Cancel reservation
app.post('/reservation/cancel', async (c) => {
    try {
        const body = await c.req.json();
        const { reservation_id, user_id, cancelled_by_user_id } = body;

        // Validation
        if (!reservation_id) {
            return c.json({
                success: false,
                error: 'Missing required field: reservation_id',
                error_th: 'กรุณาระบุหมายเลขการจอง'
            }, 400);
        }

        // 1. ตรวจสอบว่า reservation มีอยู่จริง
        const reservation = await prisma.reservation.findUnique({
            where: { reservation_id: parseInt(reservation_id) },
            include: {
                reservationtable: true,
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

        // 3. เช็คว่ายกเลิกได้หรือไม่
        if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) {
            return c.json({
                success: false,
                error: `Cannot cancel. Current status: ${reservation.status}`,
                error_th: `ไม่สามารถยกเลิกได้ สถานะปัจจุบัน: ${reservation.status}`,
                current_status: reservation.status
            }, 409);
        }

        // 4. ยกเลิกการจอง ด้วย transaction
        const result = await prisma.$transaction(async (tx) => {
            // 4.1 Update reservation status
            const updatedReservation = await tx.reservation.update({
                where: { reservation_id: reservation.reservation_id },
                data: {
                    status: 'CANCELLED',
                    updated_at: new Date()
                }
            });

            // 4.2 บันทึกลง CancelLog
            const cancelLog = await tx.cancellog.create({
                data: {
                    reservation_id: reservation.reservation_id,
                    cancelled_by_user_id: cancelled_by_user_id || user_id || null,
                    cancelled_at: new Date()
                }
            });

            // 4.3 คืนสถานะโต๊ะเป็น 'available'
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

            return { updatedReservation, cancelLog };
        });

        console.log('Reservation cancelled:', result.updatedReservation.reservation_id);

        return c.json({
            success: true,
            message: 'Reservation cancelled successfully',
            message_th: 'ยกเลิกการจองสำเร็จ',
            reservation_id: reservation.reservation_id
        }, 200);

    } catch (error) {
        console.error('Error cancelling reservation:', error);
        return c.json({
            success: false,
            error: 'Failed to cancel reservation',
            error_th: 'ยกเลิกการจองไม่สำเร็จ',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
});






export { app as reservation_service }