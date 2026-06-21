using Microsoft.EntityFrameworkCore;
using System.Data;
using AppointmentApi.Data;
using AppointmentApi.Models;

namespace AppointmentApi.Services
{
    public interface IAppointmentService
    {
        Task<Appointment> CreateAppointmentAsync(int customerId, int employeeId, int serviceId, DateTime startTimeUtc);
        Task<Appointment> RescheduleAppointmentAsync(int appointmentId, int userId, UserRole userRole, DateTime startTimeUtc);
        Task CancelAppointmentAsync(int appointmentId, int userId, UserRole userRole);
    }

    public class AppointmentService : IAppointmentService
    {
        private readonly AppDbContext _context;
        private readonly ISlotService _slotService;

        public AppointmentService(AppDbContext context, ISlotService slotService)
        {
            _context = context;
            _slotService = slotService;
        }

        public async Task<Appointment> CreateAppointmentAsync(int customerId, int employeeId, int serviceId, DateTime startTimeUtc)
        {
            startTimeUtc = startTimeUtc.Kind switch
            {
                DateTimeKind.Utc => startTimeUtc,
                DateTimeKind.Local => startTimeUtc.ToUniversalTime(),
                _ => DateTime.SpecifyKind(startTimeUtc, DateTimeKind.Utc)
            };

            if (startTimeUtc <= DateTime.UtcNow)
            {
                throw new ArgumentException("Past appointment times cannot be booked.");
            }

            // We start a transaction. In a real-world enterprise app with Postgres/SQL Server/MySQL, 
            // we use Pessimistic locking. With EF Core, we can achieve this using raw SQL with locking hints.
            using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            try
            {
                // Database-specific locking implementation:
                if (_context.Database.IsSqlite())
                {
                    // SQLite handles concurrent write transactions by setting the database to IMMEDIATE write mode.
                    // This blocks other concurrent transactions from writing until this one completes (Commit/Rollback).
                    await _context.Database.ExecuteSqlRawAsync("PRAGMA busy_timeout = 5000;"); // Wait up to 5s if locked
                }
                
                // Fetch the service to calculate duration and price
                var service = await _context.Services.FindAsync(serviceId);
                if (service == null)
                {
                    throw new ArgumentException("Service not found.");
                }

                var endTimeUtc = startTimeUtc.AddMinutes(service.DurationMinutes);

                // Fetch the staff member and verify their branch
                var employee = await _context.Users.FindAsync(employeeId);
                if (employee == null || employee.Role != UserRole.Staff)
                {
                    throw new ArgumentException("Employee not found or is not a staff member.");
                }

                if (!employee.BranchId.HasValue)
                {
                    throw new InvalidOperationException("Employee does not belong to a branch.");
                }

                if (service.BranchId != employee.BranchId.Value)
                {
                    throw new ArgumentException("The selected service is not offered by the employee's branch.");
                }

                var branch = await _context.Branches.FindAsync(employee.BranchId.Value);
                if (branch == null)
                {
                    throw new ArgumentException("Employee branch not found.");
                }

                TimeZoneInfo branchTimeZone;
                try
                {
                    branchTimeZone = TimeZoneInfo.FindSystemTimeZoneById(branch.Timezone);
                }
                catch (TimeZoneNotFoundException)
                {
                    throw new InvalidOperationException("The branch timezone is not configured correctly.");
                }

                var branchDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(startTimeUtc, branchTimeZone));
                var availableSlots = await _slotService.GetAvailableSlotsAsync(employeeId, serviceId, branchDate);
                var requestedSlot = startTimeUtc.ToString("yyyy-MM-ddTHH:mm:ssZ");
                if (!availableSlots.Contains(requestedSlot, StringComparer.Ordinal))
                {
                    throw new InvalidOperationException("The requested time is outside working hours or is no longer available.");
                }

                // Check for overlapping appointments.
                // In PostgreSQL/MySQL, we would append "FOR UPDATE" to the query to write-lock the scanned rows:
                // var hasConflict = await _context.Appointments
                //     .FromSqlRaw("SELECT * FROM Appointments WITH (UPDLOCK) WHERE EmployeeId = {0} AND Status != 2 ...", employeeId)
                //     .AnyAsync();
                
                var hasConflict = await _context.Appointments
                    .AnyAsync(a => a.EmployeeId == employeeId
                                && a.Status != AppointmentStatus.Cancelled
                                && ((startTimeUtc < a.EndTimeUtc && endTimeUtc > a.StartTimeUtc)));

                if (hasConflict)
                {
                    throw new InvalidOperationException("The requested appointment slot is already booked.");
                }

                // Create and insert the appointment
                var appointment = new Appointment
                {
                    BranchId = employee.BranchId.Value,
                    CustomerId = customerId,
                    EmployeeId = employeeId,
                    ServiceId = serviceId,
                    StartTimeUtc = startTimeUtc,
                    EndTimeUtc = endTimeUtc,
                    Status = AppointmentStatus.Approved, // Auto-approve
                    Price = service.Price,
                    CreatedAt = DateTime.UtcNow
                };

                _context.Appointments.Add(appointment);
                await _context.SaveChangesAsync();

                await transaction.CommitAsync();
                return appointment;
            }
            catch (Exception)
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        public async Task CancelAppointmentAsync(int appointmentId, int userId, UserRole userRole)
        {
            var appointment = await _context.Appointments.FindAsync(appointmentId);
            if (appointment == null)
            {
                throw new KeyNotFoundException("Appointment not found.");
            }
            if (appointment.Status == AppointmentStatus.Cancelled)
            {
                throw new InvalidOperationException("Appointment is already cancelled.");
            }
            if (appointment.EndTimeUtc <= DateTime.UtcNow)
            {
                throw new InvalidOperationException("Past appointments cannot be cancelled.");
            }

            // Role and tenancy checks:
            // Customers can only cancel their own appointments
            if (userRole == UserRole.Customer && appointment.CustomerId != userId)
            {
                throw new UnauthorizedAccessException("Customers can only cancel their own appointments.");
            }

            // Staff can only cancel their own assigned appointments
            if (userRole == UserRole.Staff && appointment.EmployeeId != userId)
            {
                throw new UnauthorizedAccessException("Staff can only cancel their own appointments.");
            }

            // Managers can cancel appointments only in their own branch
            if (userRole == UserRole.Manager)
            {
                var manager = await _context.Users.FindAsync(userId);
                if (manager == null || manager.BranchId != appointment.BranchId)
                {
                    throw new UnauthorizedAccessException("Branch managers can only cancel appointments in their own branch.");
                }
            }

            appointment.Status = AppointmentStatus.Cancelled;
            await _context.SaveChangesAsync();
        }

        public async Task<Appointment> RescheduleAppointmentAsync(int appointmentId, int userId, UserRole userRole, DateTime startTimeUtc)
        {
            startTimeUtc = startTimeUtc.Kind switch
            {
                DateTimeKind.Utc => startTimeUtc,
                DateTimeKind.Local => startTimeUtc.ToUniversalTime(),
                _ => DateTime.SpecifyKind(startTimeUtc, DateTimeKind.Utc)
            };

            if (startTimeUtc <= DateTime.UtcNow)
            {
                throw new ArgumentException("Past appointment times cannot be selected.");
            }

            using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            try
            {
                if (_context.Database.IsSqlite())
                {
                    await _context.Database.ExecuteSqlRawAsync("PRAGMA busy_timeout = 5000;");
                }

                var appointment = await _context.Appointments
                    .Include(a => a.Service)
                    .Include(a => a.Branch)
                    .FirstOrDefaultAsync(a => a.Id == appointmentId);

                if (appointment == null)
                {
                    throw new KeyNotFoundException("Appointment not found.");
                }
                if (appointment.Status == AppointmentStatus.Cancelled)
                {
                    throw new InvalidOperationException("Cancelled appointments cannot be rescheduled.");
                }

                await EnsureCanManageAppointmentAsync(appointment, userId, userRole);

                var branch = appointment.Branch ?? throw new InvalidOperationException("Appointment branch not found.");
                TimeZoneInfo branchTimeZone;
                try
                {
                    branchTimeZone = TimeZoneInfo.FindSystemTimeZoneById(branch.Timezone);
                }
                catch (TimeZoneNotFoundException)
                {
                    throw new InvalidOperationException("The branch timezone is not configured correctly.");
                }

                var branchDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(startTimeUtc, branchTimeZone));
                var slots = await _slotService.GetAvailableSlotsAsync(
                    appointment.EmployeeId,
                    appointment.ServiceId,
                    branchDate,
                    appointment.Id);

                if (!slots.Contains(startTimeUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"), StringComparer.Ordinal))
                {
                    throw new InvalidOperationException("The requested time is outside working hours or is no longer available.");
                }

                appointment.StartTimeUtc = startTimeUtc;
                appointment.EndTimeUtc = startTimeUtc.AddMinutes(appointment.Service!.DurationMinutes);
                await _context.SaveChangesAsync();
                await transaction.CommitAsync();
                return appointment;
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        private async Task EnsureCanManageAppointmentAsync(Appointment appointment, int userId, UserRole userRole)
        {
            if (userRole == UserRole.Customer && appointment.CustomerId != userId)
            {
                throw new UnauthorizedAccessException("Customers can only manage their own appointments.");
            }
            if (userRole == UserRole.Staff && appointment.EmployeeId != userId)
            {
                throw new UnauthorizedAccessException("Staff can only manage their assigned appointments.");
            }
            if (userRole == UserRole.Manager)
            {
                var manager = await _context.Users.FindAsync(userId);
                if (manager == null || manager.BranchId != appointment.BranchId)
                {
                    throw new UnauthorizedAccessException("Branch managers can only manage appointments in their own branch.");
                }
            }
        }
    }
}
