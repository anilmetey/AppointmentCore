using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using AppointmentApi.Models;
using AppointmentApi.Services;
using AppointmentApi.Data;
using Microsoft.EntityFrameworkCore;

namespace AppointmentApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class AppointmentController : ControllerBase
    {
        private readonly IAppointmentService _appointmentService;
        private readonly AppDbContext _context;

        public AppointmentController(IAppointmentService appointmentService, AppDbContext context)
        {
            _appointmentService = appointmentService;
            _context = context;
        }

        public class CreateAppointmentRequest
        {
            public int EmployeeId { get; set; }
            public int ServiceId { get; set; }
            public DateTime StartTimeUtc { get; set; }
        }

        public class RescheduleAppointmentRequest
        {
            public DateTime StartTimeUtc { get; set; }
        }

        [HttpPost]
        [Authorize(Roles = "Customer")]
        public async Task<IActionResult> Create([FromBody] CreateAppointmentRequest request)
        {
            var userIdStr = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out int customerId))
            {
                return Unauthorized(new { error = "Invalid token credentials." });
            }

            try
            {
                var appointment = await _appointmentService.CreateAppointmentAsync(
                    customerId, 
                    request.EmployeeId, 
                    request.ServiceId, 
                    request.StartTimeUtc
                );

                return CreatedAtAction(nameof(GetById), new { id = appointment.Id }, appointment);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(StatusCodes.Status422UnprocessableEntity, new { error = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new { error = "An error occurred while booking.", details = ex.Message });
            }
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(int id)
        {
            var appointment = await _context.Appointments
                .Include(a => a.Service)
                .Include(a => a.Employee)
                .Include(a => a.Customer)
                .FirstOrDefaultAsync(a => a.Id == id);

            if (appointment == null)
            {
                return NotFound(new { error = "Appointment not found." });
            }

            var userIdStr = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var userRoleStr = User.FindFirst(ClaimTypes.Role)?.Value;
            var userBranchStr = User.FindFirst("branch_id")?.Value;

            if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out int userId))
            {
                return Unauthorized();
            }

            if (!Enum.TryParse<UserRole>(userRoleStr, out var role))
            {
                return Unauthorized(new { error = "Invalid role claim." });
            }

            if (role != UserRole.Admin)
            {
                if (role == UserRole.Manager && (!int.TryParse(userBranchStr, out int managerBranchId) || appointment.BranchId != managerBranchId))
                {
                    return Forbid();
                }
                if (role == UserRole.Staff && appointment.EmployeeId != userId)
                {
                    return Forbid();
                }
                if (role == UserRole.Customer && appointment.CustomerId != userId)
                {
                    return Forbid();
                }
            }

            return Ok(appointment);
        }

        [HttpGet("my-appointments")]
        public async Task<IActionResult> GetMyAppointments()
        {
            var userIdStr = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var userRoleStr = User.FindFirst(ClaimTypes.Role)?.Value;

            if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out int userId))
            {
                return Unauthorized();
            }

            if (!Enum.TryParse<UserRole>(userRoleStr, out var role))
            {
                return Unauthorized(new { error = "Invalid role claim." });
            }

            IQueryable<Appointment> query = _context.Appointments
                .Include(a => a.Service)
                .Include(a => a.Employee)
                .Include(a => a.Customer)
                .Include(a => a.Branch);

            if (role == UserRole.Customer)
            {
                query = query.Where(a => a.CustomerId == userId);
            }
            else if (role == UserRole.Staff)
            {
                query = query.Where(a => a.EmployeeId == userId);
            }
            else if (role == UserRole.Manager)
            {
                var user = await _context.Users.FindAsync(userId);
                if (user != null && user.BranchId.HasValue)
                {
                    query = query.Where(a => a.BranchId == user.BranchId.Value);
                }
            }

            var appointments = await query
                .OrderByDescending(a => a.StartTimeUtc)
                .ToListAsync();

            return Ok(appointments);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> Cancel(int id)
        {
            var userIdStr = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var userRoleStr = User.FindFirst(ClaimTypes.Role)?.Value;

            if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out int userId) || string.IsNullOrEmpty(userRoleStr))
            {
                return Unauthorized();
            }

            if (!Enum.TryParse<UserRole>(userRoleStr, out var userRole))
            {
                return Unauthorized(new { error = "Invalid role claim." });
            }

            try
            {
                await _appointmentService.CancelAppointmentAsync(id, userId, userRole);
                return Ok(new { message = "Appointment successfully cancelled." });
            }
            catch (KeyNotFoundException)
            {
                return NotFound(new { error = "Appointment not found." });
            }
            catch (UnauthorizedAccessException ex)
            {
                var ipAddress = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "Unknown";
                var userAgent = HttpContext.Request.Headers["User-Agent"].ToString();

                var log = new SecurityLog
                {
                    UserId = userId,
                    Action = "UNAUTHORIZED_CANCEL_ATTEMPT",
                    IpAddress = ipAddress,
                    UserAgent = userAgent,
                    Details = $"User {userId} ({userRole}) attempted to cancel appointment {id}. Error: {ex.Message}",
                    CreatedAt = DateTime.UtcNow
                };

                _context.SecurityLogs.Add(log);
                await _context.SaveChangesAsync();

                return StatusCode(StatusCodes.Status403Forbidden, new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(StatusCodes.Status422UnprocessableEntity, new { error = ex.Message });
            }
        }

        [HttpPut("{id}/reschedule")]
        public async Task<IActionResult> Reschedule(int id, [FromBody] RescheduleAppointmentRequest request)
        {
            var userIdValue = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var roleValue = User.FindFirst(ClaimTypes.Role)?.Value;
            if (!int.TryParse(userIdValue, out var userId) || !Enum.TryParse<UserRole>(roleValue, out var role))
            {
                return Unauthorized(new { error = "Invalid token credentials." });
            }

            try
            {
                var appointment = await _appointmentService.RescheduleAppointmentAsync(id, userId, role, request.StartTimeUtc);
                return Ok(appointment);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { error = ex.Message });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(StatusCodes.Status422UnprocessableEntity, new { error = ex.Message });
            }
        }

        [HttpGet("security-logs")]
        [Authorize(Roles = "Admin")]
        public async Task<IActionResult> GetSecurityLogs()
        {
            var logs = await _context.SecurityLogs
                .Include(l => l.User)
                .OrderByDescending(l => l.CreatedAt)
                .ToListAsync();

            return Ok(logs);
        }
    }
}
