using Microsoft.EntityFrameworkCore;
using AppointmentApi.Data;
using AppointmentApi.Models;

namespace AppointmentApi.Services
{
    public interface ISlotService
    {
        Task<List<string>> GetAvailableSlotsAsync(int employeeId, int serviceId, DateOnly date, int? excludeAppointmentId = null);
    }

    public class SlotService : ISlotService
    {
        private readonly AppDbContext _context;

        public SlotService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<string>> GetAvailableSlotsAsync(int employeeId, int serviceId, DateOnly date, int? excludeAppointmentId = null)
        {
            // 1. Fetch Employee, Branch and Service
            var employee = await _context.Users
                .Include(u => u.Branch)
                .FirstOrDefaultAsync(u => u.Id == employeeId && u.Role == UserRole.Staff);

            if (employee == null || employee.Branch == null)
            {
                throw new ArgumentException("Staff employee or branch not found.");
            }

            var service = await _context.Services.FindAsync(serviceId);
            if (service == null)
            {
                throw new ArgumentException("Service not found.");
            }

            if (service.BranchId != employee.BranchId)
            {
                throw new ArgumentException("The selected service is not offered by the employee's branch.");
            }

            var branchTzId = employee.Branch.Timezone;
            TimeZoneInfo tz;
            try
            {
                tz = TimeZoneInfo.FindSystemTimeZoneById(branchTzId);
            }
            catch (TimeZoneNotFoundException)
            {
                // Fallback for cross-platform compatibility if running in environments with different timezone databases
                tz = TimeZoneInfo.Utc;
            }

            // 2. Fetch Working Hours for the specific day of the week
            var dayOfWeek = date.DayOfWeek;
            var workingHour = await _context.WorkingHours
                .FirstOrDefaultAsync(w => w.UserId == employeeId && w.DayOfWeek == dayOfWeek);

            if (workingHour == null)
            {
                return new List<string>(); // Not working on this day
            }

            // 3. Construct local start/end times in the branch's timezone
            var localDate = new DateTime(date.Year, date.Month, date.Day);
            
            var localStart = localDate.Add(workingHour.StartTime);
            var localEnd = localDate.Add(workingHour.EndTime);

            // Convert to UTC for database querying and standard representation
            var utcStart = TimeZoneInfo.ConvertTimeToUtc(localStart, tz);
            var utcEnd = TimeZoneInfo.ConvertTimeToUtc(localEnd, tz);

            // 4. Fetch booked appointments for this employee on this day
            var bookings = await _context.Appointments
                .Where(a => a.EmployeeId == employeeId 
                         && (!excludeAppointmentId.HasValue || a.Id != excludeAppointmentId.Value)
                         && a.Status != AppointmentStatus.Cancelled
                         && a.StartTimeUtc < utcEnd
                         && a.EndTimeUtc > utcStart)
                .Select(a => new { a.StartTimeUtc, a.EndTimeUtc })
                .ToListAsync();

            // 5. Generate slots
            var availableSlots = new List<string>();
            var slotDuration = TimeSpan.FromMinutes(service.DurationMinutes);
            var currentLocal = localStart;

            while (currentLocal + slotDuration <= localEnd)
            {
                var slotEndLocal = currentLocal + slotDuration;

                // Check lunch break overlap in local timezone
                var overlapsLunch = false;
                if (workingHour.LunchStartTime.HasValue && workingHour.LunchEndTime.HasValue)
                {
                    var lunchStart = localDate.Add(workingHour.LunchStartTime.Value);
                    var lunchEnd = localDate.Add(workingHour.LunchEndTime.Value);
                    
                    // Overlap logic: Start1 < End2 && End1 > Start2
                    if (currentLocal < lunchEnd && slotEndLocal > lunchStart)
                    {
                        overlapsLunch = true;
                    }
                }

                // Check appointment overlap in UTC timezone
                var overlapsBooking = false;
                var currentUtc = TimeZoneInfo.ConvertTimeToUtc(currentLocal, tz);
                var slotEndUtc = TimeZoneInfo.ConvertTimeToUtc(slotEndLocal, tz);

                foreach (var booking in bookings)
                {
                    if (currentUtc < booking.EndTimeUtc && slotEndUtc > booking.StartTimeUtc)
                    {
                        overlapsBooking = true;
                        break;
                    }
                }

                if (!overlapsLunch && !overlapsBooking && currentUtc > DateTime.UtcNow)
                {
                    // Format output as ISO 8601 UTC string
                    availableSlots.Add(currentUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"));
                }

                // Advance by 15-minute increments for booking flexibility (or by slotDuration)
                // Sliding by 15 minutes lets customers book appointments starting every 15 minutes (e.g., 09:00, 09:15, 09:30).
                // If we advanced by slotDuration, slots would only start at block boundaries (e.g., 09:00, 09:45).
                // Let's slide by 15 minutes to match premium booking systems, but ensure slot fits.
                currentLocal = currentLocal.Add(TimeSpan.FromMinutes(15));
            }

            return availableSlots;
        }
    }
}
