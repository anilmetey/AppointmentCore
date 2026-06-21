using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using AppointmentApi.Data;
using AppointmentApi.Models;
using AppointmentApi.Services;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;

namespace AppointmentApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ITokenService _tokenService;
        private readonly PasswordHasher<string> _passwordHasher = new();

        public AuthController(AppDbContext context, ITokenService tokenService)
        {
            _context = context;
            _tokenService = tokenService;
        }

        public class LoginRequest
        {
            [Required]
            [EmailAddress]
            public string Email { get; set; } = string.Empty;

            [Required]
            public string Password { get; set; } = string.Empty;
        }

        public class RegisterRequest
        {
            [Required]
            [MaxLength(100)]
            public string Name { get; set; } = string.Empty;

            [Required]
            [EmailAddress]
            [MaxLength(100)]
            public string Email { get; set; } = string.Empty;

            [Required]
            [MinLength(6)]
            public string Password { get; set; } = string.Empty;

            public int? BranchId { get; set; }
        }

        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            var normalizedEmail = request.Email.Trim().ToLowerInvariant();
            var user = await _context.Users
                .FirstOrDefaultAsync(u => u.Email.ToLower() == normalizedEmail);

            if (user == null)
            {
                return Unauthorized(new { error = "Invalid email or password." });
            }

            var verificationResult = _passwordHasher.VerifyHashedPassword(
                user.Email, 
                user.PasswordHash, 
                request.Password
            );

            if (verificationResult == PasswordVerificationResult.Failed)
            {
                return Unauthorized(new { error = "Invalid email or password." });
            }

            var token = _tokenService.GenerateToken(user);

            return Ok(new
            {
                token,
                user = new
                {
                    user.Id,
                    user.Name,
                    user.Email,
                    user.Role,
                    user.BranchId
                }
            });
        }

        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] RegisterRequest request)
        {
            var normalizedEmail = request.Email.Trim().ToLowerInvariant();
            var normalizedName = request.Name.Trim();
            if (normalizedName.Length == 0)
            {
                return BadRequest(new { error = "Ad soyad boş olamaz." });
            }

            // Check if email already exists
            var existingUser = await _context.Users
                .AnyAsync(u => u.Email.ToLower() == normalizedEmail);

            if (existingUser)
            {
                return BadRequest(new { error = "E-posta adresi zaten kullanımda." });
            }

            // Default branch to first branch if not specified
            int? targetBranchId = request.BranchId;
            if (!targetBranchId.HasValue)
            {
                var defaultBranch = await _context.Branches.FirstOrDefaultAsync();
                targetBranchId = defaultBranch?.Id;
            }

            var newUser = new User
            {
                Name = normalizedName,
                Email = normalizedEmail,
                Role = UserRole.Customer,
                BranchId = targetBranchId,
                CreatedAt = DateTime.UtcNow
            };

            newUser.PasswordHash = _passwordHasher.HashPassword(newUser.Email, request.Password);

            _context.Users.Add(newUser);
            await _context.SaveChangesAsync();

            var token = _tokenService.GenerateToken(newUser);

            return Created("", new
            {
                token,
                user = new
                {
                    newUser.Id,
                    newUser.Name,
                    newUser.Email,
                    newUser.Role,
                    newUser.BranchId
                }
            });
        }

        public class UpdateProfileRequest
        {
            [Required, MaxLength(100)]
            public string Name { get; set; } = string.Empty;

            [Required, EmailAddress, MaxLength(100)]
            public string Email { get; set; } = string.Empty;
        }

        public class ChangePasswordRequest
        {
            [Required]
            public string CurrentPassword { get; set; } = string.Empty;

            [Required, MinLength(8), MaxLength(100)]
            public string NewPassword { get; set; } = string.Empty;
        }

        [HttpPut("profile")]
        [Authorize]
        public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
        {
            var userIdValue = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdValue, out var userId))
            {
                return Unauthorized(new { error = "Geçersiz oturum." });
            }

            var user = await _context.Users.FindAsync(userId);
            if (user == null)
            {
                return NotFound(new { error = "Kullanıcı bulunamadı." });
            }

            var normalizedName = request.Name.Trim();
            var normalizedEmail = request.Email.Trim().ToLowerInvariant();
            if (normalizedName.Length == 0)
            {
                return BadRequest(new { error = "Ad soyad boş olamaz." });
            }

            if (await _context.Users.AnyAsync(u => u.Id != userId && u.Email.ToLower() == normalizedEmail))
            {
                return Conflict(new { error = "E-posta adresi zaten kullanımda." });
            }

            user.Name = normalizedName;
            user.Email = normalizedEmail;
            await _context.SaveChangesAsync();

            return Ok(new
            {
                user = new { user.Id, user.Name, user.Email, user.Role, user.BranchId }
            });
        }

        [HttpPut("password")]
        [Authorize]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            var userIdValue = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdValue, out var userId))
            {
                return Unauthorized(new { error = "Geçersiz oturum." });
            }

            var user = await _context.Users.FindAsync(userId);
            if (user == null)
            {
                return NotFound(new { error = "Kullanıcı bulunamadı." });
            }

            var verification = _passwordHasher.VerifyHashedPassword(user.Email, user.PasswordHash, request.CurrentPassword);
            if (verification == PasswordVerificationResult.Failed)
            {
                return BadRequest(new { error = "Mevcut şifre hatalı." });
            }
            if (request.CurrentPassword == request.NewPassword)
            {
                return BadRequest(new { error = "Yeni şifre mevcut şifreden farklı olmalıdır." });
            }
            if (!request.NewPassword.Any(char.IsUpper)
                || !request.NewPassword.Any(char.IsLower)
                || !request.NewPassword.Any(char.IsDigit))
            {
                return BadRequest(new { error = "Yeni şifre büyük harf, küçük harf ve rakam içermelidir." });
            }

            user.PasswordHash = _passwordHasher.HashPassword(user.Email, request.NewPassword);
            await _context.SaveChangesAsync();
            return Ok(new { message = "Şifre başarıyla güncellendi." });
        }
    }
}
