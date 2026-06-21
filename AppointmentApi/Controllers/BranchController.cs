using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using AppointmentApi.Data;
using AppointmentApi.Filters;
using AppointmentApi.Services;
using System.Globalization;

namespace AppointmentApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class BranchController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ISlotService _slotService;

        public BranchController(AppDbContext context, ISlotService slotService)
        {
            _context = context;
            _slotService = slotService;
        }

        [HttpGet("{branchId}/employees/{employeeId}/slots")]
        public async Task<IActionResult> GetSlots(int branchId, int employeeId, [FromQuery] int serviceId, [FromQuery] string date)
        {
            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
            {
                return BadRequest(new { error = "Invalid date format. Use YYYY-MM-DD." });
            }

            try
            {
                // Verify employee belongs to requested branch
                var employee = await _context.Users.FindAsync(employeeId);
                if (employee == null || employee.BranchId != branchId)
                {
                    return BadRequest(new { error = "Employee does not exist in the specified branch." });
                }

                var slots = await _slotService.GetAvailableSlotsAsync(employeeId, serviceId, parsedDate);
                return Ok(slots);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = "Failed to calculate slots.", details = ex.Message });
            }
        }

        [HttpGet("{branchId}/earliest-slot")]
        public async Task<IActionResult> GetEarliestSlot(
            int branchId,
            [FromQuery] int serviceId,
            [FromQuery] string fromDate,
            [FromQuery] int days = 14)
        {
            if (!DateOnly.TryParseExact(fromDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
            {
                return BadRequest(new { error = "Invalid date format. Use YYYY-MM-DD." });
            }
            if (days is < 1 or > 31)
            {
                return BadRequest(new { error = "Search range must be between 1 and 31 days." });
            }

            var serviceExists = await _context.Services.AnyAsync(s => s.Id == serviceId && s.BranchId == branchId);
            if (!serviceExists)
            {
                return BadRequest(new { error = "Service does not exist in the specified branch." });
            }

            var staff = await _context.Users
                .Where(u => u.BranchId == branchId && u.Role == Models.UserRole.Staff)
                .Select(u => new { u.Id, u.Name })
                .ToListAsync();

            for (var offset = 0; offset < days; offset++)
            {
                var date = parsedDate.AddDays(offset);
                string? earliestSlot = null;
                int earliestEmployeeId = 0;
                string? earliestEmployeeName = null;

                foreach (var employee in staff)
                {
                    var slots = await _slotService.GetAvailableSlotsAsync(employee.Id, serviceId, date);
                    var firstSlot = slots.FirstOrDefault();
                    if (firstSlot != null && (earliestSlot == null || string.CompareOrdinal(firstSlot, earliestSlot) < 0))
                    {
                        earliestSlot = firstSlot;
                        earliestEmployeeId = employee.Id;
                        earliestEmployeeName = employee.Name;
                    }
                }

                if (earliestSlot != null)
                {
                    return Ok(new
                    {
                        employeeId = earliestEmployeeId,
                        employeeName = earliestEmployeeName,
                        date = date.ToString("yyyy-MM-dd"),
                        slotUtc = earliestSlot
                    });
                }
            }

            return NotFound(new { error = $"No available slot was found in the next {days} days." });
        }

        [HttpGet("{branchId}/appointments")]
        [Authorize(Roles = "Admin,Manager")]
        [BranchAuthorize]
        public async Task<IActionResult> GetBranchAppointments(int branchId)
        {
            var appointments = await _context.Appointments
                .Include(a => a.Service)
                .Include(a => a.Employee)
                .Include(a => a.Customer)
                .Where(a => a.BranchId == branchId)
                .OrderBy(a => a.StartTimeUtc)
                .ToListAsync();

            return Ok(appointments);
        }

        [HttpGet]
        public async Task<IActionResult> GetBranches()
        {
            var branches = await _context.Branches
                .Where(b => b.Services.Any() && b.Users.Any(u => u.Role == Models.UserRole.Staff))
                .Select(b => new { b.Id, b.Name, b.Timezone, b.Address })
                .ToListAsync();
            return Ok(branches);
        }

        [HttpGet("{branchId}/staff")]
        public async Task<IActionResult> GetBranchStaff(int branchId)
        {
            var staff = await _context.Users
                .Where(u => u.BranchId == branchId && u.Role == Models.UserRole.Staff)
                .Select(u => new { u.Id, u.Name, u.Email })
                .ToListAsync();
            return Ok(staff);
        }

        [HttpGet("{branchId}/services")]
        public async Task<IActionResult> GetBranchServices(int branchId)
        {
            var services = await _context.Services
                .Where(s => s.BranchId == branchId)
                .Select(s => new { s.Id, s.Name, s.DurationMinutes, s.Price })
                .ToListAsync();
            return Ok(services);
        }
    }
}
